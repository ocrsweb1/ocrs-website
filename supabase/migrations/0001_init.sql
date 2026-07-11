-- ============================================================
-- OCRS — Postgres schema for Supabase
-- Southern Luzon State University — Lucena Campus
--
-- Mirrors the Firestore data model 1:1 but as relational tables with
-- Row Level Security (RLS) instead of Firestore Security Rules.
--
-- Key design decisions (same intent as the Firestore version):
--  - Role lives in `profiles.role`, looked up through SECURITY DEFINER
--    helper functions so RLS policies can call them without recursive
--    RLS evaluation on `profiles` itself.
--  - Students: read-only, own rows only.
--  - Faculty: read/write only their own classes/rosters, and only
--    while `classes.locked = false`.
--  - `computed_final_grade` / `gpa_equivalent` are recomputed by a
--    BEFORE INSERT/UPDATE trigger from the raw score columns every
--    single time — whatever a client sends for those two columns is
--    simply overwritten, so there's no way to fake a grade.
--  - `classes.locked` cannot be changed by ordinary UPDATE at all
--    (enforced by a trigger) — only the lock-class-grades /
--    unlock-class-grades Edge Functions (using the service role key,
--    which bypasses RLS) may change it, and both write an audit log row.
--  - `audit_logs` has no INSERT policy for the `authenticated` role at
--    all — only the service role (Edge Functions) can write to it.
-- ============================================================

-- ---------- extensions ----------
create extension if not exists "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null check (role in ('student','faculty','admin')),
  status text not null default 'active' check (status in ('active','inactive')),
  student_number text,
  employee_number text,
  program text,
  year_level text,
  section text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  status_updated_at timestamptz,
  status_updated_by uuid references auth.users(id)
);

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  year text not null,
  is_active boolean not null default false
);

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  is_active boolean not null default false
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  units integer not null default 3,
  program text
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  program text,
  year_level text
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id),
  section_id uuid not null references public.sections(id),
  faculty_id uuid not null references public.profiles(id),
  academic_year_id uuid not null references public.academic_years(id),
  semester_id uuid not null references public.semesters(id),
  grade_weights jsonb not null default '{"activities":20,"quizzes":20,"projects":20,"midtermExam":20,"finalExam":20}',
  locked boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by uuid references auth.users(id),
  unlocked_at timestamptz,
  unlocked_by uuid references auth.users(id),
  last_unlock_reason text
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  status text not null default 'active',
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid references auth.users(id),
  unique (class_id, student_id)
);

create table public.grade_records (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  activities numeric[] not null default '{}',
  quizzes numeric[] not null default '{}',
  projects numeric[] not null default '{}',
  midterm_exam numeric,
  final_exam numeric,
  computed_final_grade numeric,
  gpa_equivalent numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (class_id, student_id)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  date date not null,
  status text not null check (status in ('present','late','absent','excused')),
  remarks text,
  recorded_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (class_id, student_id, date)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  generated_by uuid references auth.users(id),
  generated_by_name text,
  generated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  performed_by uuid references auth.users(id),
  performed_by_name text,
  target_table text,
  target_id text,
  details text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- HELPER FUNCTIONS (SECURITY DEFINER — bypass RLS internally so they
-- can safely be called FROM inside RLS policies without recursion)
-- ============================================================

create or replace function public.current_profile()
returns public.profiles
language sql security definer stable
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create or replace function public.is_faculty()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'faculty' and status = 'active');
$$;

create or replace function public.is_student()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'student' and status = 'active');
$$;

create or replace function public.is_active_user()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.owns_class(p_class_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.classes where id = p_class_id and faculty_id = auth.uid());
$$;

create or replace function public.class_locked(p_class_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select locked from public.classes where id = p_class_id), true);
$$;

create or replace function public.is_enrolled(p_class_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.enrollments where class_id = p_class_id and student_id = auth.uid());
$$;

-- ============================================================
-- GRADE COMPUTATION TRIGGER
-- Authoritatively (re)computes computed_final_grade & gpa_equivalent
-- from raw scores + the owning class's grade_weights, on every
-- insert/update — a client's own value for these two columns (if any)
-- is always discarded and replaced.
-- ============================================================

create or replace function public.compute_grade_record()
returns trigger language plpgsql as $$
declare
  w jsonb;
  w_activities numeric; w_quizzes numeric; w_projects numeric; w_midterm numeric; w_final numeric;
  avg_activities numeric; avg_quizzes numeric; avg_projects numeric;
  weighted_sum numeric := 0;
  weight_used numeric := 0;
  final_grade numeric;
begin
  select grade_weights into w from public.classes where id = new.class_id;
  w_activities := coalesce((w->>'activities')::numeric, 20);
  w_quizzes    := coalesce((w->>'quizzes')::numeric, 20);
  w_projects   := coalesce((w->>'projects')::numeric, 20);
  w_midterm    := coalesce((w->>'midtermExam')::numeric, 20);
  w_final      := coalesce((w->>'finalExam')::numeric, 20);

  if array_length(new.activities, 1) > 0 then
    select avg(x) into avg_activities from unnest(new.activities) x;
    weighted_sum := weighted_sum + avg_activities * (w_activities / 100.0);
    weight_used := weight_used + w_activities;
  end if;
  if array_length(new.quizzes, 1) > 0 then
    select avg(x) into avg_quizzes from unnest(new.quizzes) x;
    weighted_sum := weighted_sum + avg_quizzes * (w_quizzes / 100.0);
    weight_used := weight_used + w_quizzes;
  end if;
  if array_length(new.projects, 1) > 0 then
    select avg(x) into avg_projects from unnest(new.projects) x;
    weighted_sum := weighted_sum + avg_projects * (w_projects / 100.0);
    weight_used := weight_used + w_projects;
  end if;
  if new.midterm_exam is not null then
    weighted_sum := weighted_sum + new.midterm_exam * (w_midterm / 100.0);
    weight_used := weight_used + w_midterm;
  end if;
  if new.final_exam is not null then
    weighted_sum := weighted_sum + new.final_exam * (w_final / 100.0);
    weight_used := weight_used + w_final;
  end if;

  if weight_used >= 100 then
    final_grade := round((weighted_sum / weight_used) * 100, 2);
    new.computed_final_grade := final_grade;
    new.gpa_equivalent :=
      case
        when final_grade >= 97 then 1.00 when final_grade >= 94 then 1.25
        when final_grade >= 91 then 1.50 when final_grade >= 88 then 1.75
        when final_grade >= 85 then 2.00 when final_grade >= 82 then 2.25
        when final_grade >= 79 then 2.50 when final_grade >= 76 then 2.75
        when final_grade >= 75 then 3.00 else 5.00
      end;
  else
    new.computed_final_grade := null;
    new.gpa_equivalent := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_compute_grade_record
  before insert or update on public.grade_records
  for each row execute function public.compute_grade_record();

-- Block any direct change to `locked` outside of the two Edge Functions,
-- which use the service role key and therefore run as the `postgres`
-- role — this trigger only fires for the `authenticated` role.
create or replace function public.block_direct_lock_change()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'authenticated' and new.locked is distinct from old.locked then
    raise exception 'classes.locked can only be changed via the lock-class-grades / unlock-class-grades functions';
  end if;
  return new;
end;
$$;

create trigger trg_block_direct_lock_change
  before update on public.classes
  for each row execute function public.block_direct_lock_change();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.academic_years enable row level security;
alter table public.semesters enable row level security;
alter table public.subjects enable row level security;
alter table public.sections enable row level security;
alter table public.classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.grade_records enable row level security;
alter table public.attendance_records enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------- profiles ----------------
-- Self, admins, and faculty (to build rosters) can read. No client
-- INSERT/UPDATE/DELETE at all — only the create-user-account /
-- set-user-status Edge Functions (service role) touch this table.
create policy "profiles_select" on public.profiles for select
  using (public.is_admin() or id = auth.uid() or (public.is_faculty() and role = 'student'));

-- ---------------- academic structure (admin-managed) ----------------
create policy "academic_years_select" on public.academic_years for select using (public.is_active_user());
create policy "academic_years_write" on public.academic_years for all using (public.is_admin()) with check (public.is_admin());

create policy "semesters_select" on public.semesters for select using (public.is_active_user());
create policy "semesters_write" on public.semesters for all using (public.is_admin()) with check (public.is_admin());

create policy "subjects_select" on public.subjects for select using (public.is_active_user());
create policy "subjects_write" on public.subjects for all using (public.is_admin()) with check (public.is_admin());

create policy "sections_select" on public.sections for select using (public.is_active_user());
create policy "sections_write" on public.sections for all using (public.is_admin()) with check (public.is_admin());

-- ---------------- classes ----------------
create policy "classes_select" on public.classes for select
  using (public.is_admin() or faculty_id = auth.uid() or public.is_enrolled(id));

create policy "classes_insert" on public.classes for insert
  with check (public.is_faculty() and faculty_id = auth.uid() and locked = false);

-- Faculty may update their own unlocked class (e.g. grade_weights); the
-- trg_block_direct_lock_change trigger separately forbids `locked` from
-- changing here regardless of role = 'authenticated'. Admin bypasses
-- that trigger check only via the service-role Edge Functions, same as
-- faculty — i.e. NOBODY changes `locked` through a normal client update.
create policy "classes_update" on public.classes for update
  using (public.is_admin() or (faculty_id = auth.uid() and locked = false))
  with check (public.is_admin() or faculty_id = auth.uid());

create policy "classes_delete" on public.classes for delete using (public.is_admin());

-- ---------------- enrollments ----------------
create policy "enrollments_select" on public.enrollments for select
  using (public.is_admin() or public.owns_class(class_id) or student_id = auth.uid());

create policy "enrollments_write" on public.enrollments for all
  using (public.is_admin() or public.owns_class(class_id))
  with check (public.is_admin() or public.owns_class(class_id));

-- ---------------- grade_records ----------------
create policy "grade_records_select" on public.grade_records for select
  using (public.is_admin() or public.owns_class(class_id) or student_id = auth.uid());

create policy "grade_records_insert" on public.grade_records for insert
  with check (public.is_faculty() and public.owns_class(class_id) and not public.class_locked(class_id));

create policy "grade_records_update" on public.grade_records for update
  using (public.is_admin() or (public.owns_class(class_id) and not public.class_locked(class_id)))
  with check (public.is_admin() or public.owns_class(class_id));

create policy "grade_records_delete" on public.grade_records for delete using (public.is_admin());

-- ---------------- attendance_records ----------------
create policy "attendance_select" on public.attendance_records for select
  using (public.is_admin() or public.owns_class(class_id) or student_id = auth.uid());

create policy "attendance_write" on public.attendance_records for all
  using (public.is_admin() or public.owns_class(class_id))
  with check (public.is_admin() or public.owns_class(class_id));

-- ---------------- reports ----------------
-- Reports are only ever written by the generate-report Edge Function
-- (service role); clients may only read their own / admins read all.
create policy "reports_select" on public.reports for select
  using (public.is_admin() or generated_by = auth.uid());

-- ---------------- audit_logs ----------------
-- Admin read-only. No insert/update/delete policy exists for the
-- `authenticated` role at all, so only the service role can write.
create policy "audit_logs_select" on public.audit_logs for select using (public.is_admin());

-- ============================================================
-- Realtime (optional): let dashboards subscribe to live changes.
-- Safe to run even if the publication already exists.
-- ============================================================
alter publication supabase_realtime add table public.grade_records, public.classes, public.attendance_records;
