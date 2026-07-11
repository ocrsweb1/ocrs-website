-- ============================================================
-- OCRS — compute_grade_record() test suite
--
-- Self-contained: creates its own fixtures (auth users, profiles,
-- academic structure, classes, grade_records), asserts against them,
-- and cleans everything up at the end regardless of pass/fail.
--
-- Run against a migrated database (0001 + 0002 applied):
--   supabase start && supabase db reset
--   psql "$(supabase status -o json | jq -r .DB_URL)" \
--     -f supabase/tests/compute_grade_record.test.sql
--
-- Or paste directly into the Supabase Studio SQL editor
-- (http://127.0.0.1:54323 while `supabase start` is running).
--
-- Any failed assertion raises an exception and aborts (with cleanup
-- still running), so "no errors, and the final NOTICE shows N/N" ==
-- "all tests passed".
-- ============================================================

-- Note: the exact set of NOT NULL columns on auth.users can vary slightly
-- across Supabase CLI/Postgres versions. If the INSERT below fails on a
-- missing-column error, add the missing column(s) with an empty-string or
-- default value — the columns used here (id, email, encrypted_password,
-- email_confirmed_at, created_at, updated_at, aud, role) are the common
-- baseline that's been stable across recent CLI releases.

-- Session-scoped helper (pg_temp is dropped automatically when the
-- connection closes, so this never leaks into the real schema).
create or replace function pg_temp.assert_eq(label text, actual anyelement, expected anyelement)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL [%]: expected %, got %', label, expected, actual;
  else
    raise notice 'PASS [%]: % = %', label, actual, expected;
  end if;
end;
$$;

do $$
declare
  faculty_id uuid;
  student1_id uuid;
  student2_id uuid;
  ayr_id uuid;
  sem_id uuid;
  subj_id uuid;
  sect_id uuid;
  class_multi_id uuid;   -- per-item mode, multiple items per category
  class_legacy_id uuid;  -- grade_components left NULL -> legacy fallback
  final_grade_val numeric;
  gpa_val numeric;
begin
  -- ---------------- fixtures ----------------
  faculty_id := gen_random_uuid();
  student1_id := gen_random_uuid();
  student2_id := gen_random_uuid();

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
  values
    (faculty_id, 'test-faculty-' || faculty_id || '@example.test', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
    (student1_id, 'test-student1-' || student1_id || '@example.test', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
    (student2_id, 'test-student2-' || student2_id || '@example.test', 'x', now(), now(), now(), 'authenticated', 'authenticated');

  insert into public.profiles (id, full_name, email, role, status)
  values
    (faculty_id, 'Test Faculty', (select email from auth.users where id = faculty_id), 'faculty', 'active'),
    (student1_id, 'Test Student One', (select email from auth.users where id = student1_id), 'student', 'active'),
    (student2_id, 'Test Student Two', (select email from auth.users where id = student2_id), 'student', 'active');

  insert into public.academic_years (year, is_active) values ('TEST-YEAR', true) returning id into ayr_id;
  insert into public.semesters (name, academic_year_id, is_active) values ('TEST-SEM', ayr_id, true) returning id into sem_id;
  insert into public.subjects (code, title, units, program) values ('TST101', 'Test Subject', 3, 'TEST') returning id into subj_id;
  insert into public.sections (name, program, year_level) values ('TEST-SEC', 'TEST', '1st Year') returning id into sect_id;

  -- ============================================================
  -- TEST GROUP 1: per-item mode, multiple items, full scores
  -- Act1(5%)=100, Act2(5%)=80, Quiz1(10%)=90, Quiz2(10%)=70,
  -- Project(20%)=85, Midterm(25%)=88, Final(25%)=92
  -- Expected = 100*.05 + 80*.05 + 90*.10 + 70*.10 + 85*.20 + 88*.25 + 92*.25
  --          = 5 + 4 + 9 + 7 + 17 + 22 + 23 = 87
  -- ============================================================
  insert into public.classes (subject_id, section_id, faculty_id, academic_year_id, semester_id, grade_components)
  values (subj_id, sect_id, faculty_id, ayr_id, sem_id, jsonb_build_object(
    'activities', jsonb_build_array(jsonb_build_object('label','Act 1','weight',5), jsonb_build_object('label','Act 2','weight',5)),
    'quizzes', jsonb_build_array(jsonb_build_object('label','Quiz 1','weight',10), jsonb_build_object('label','Quiz 2','weight',10)),
    'projects', jsonb_build_array(jsonb_build_object('label','Project','weight',20)),
    'midtermExam', jsonb_build_object('label','Midterm','weight',25),
    'finalExam', jsonb_build_object('label','Final','weight',25)
  )) returning id into class_multi_id;

  insert into public.grade_records (class_id, student_id, activities, quizzes, projects, midterm_exam, final_exam)
  values (class_multi_id, student1_id, array[100,80], array[90,70], array[85], 88, 92);

  select computed_final_grade, gpa_equivalent into final_grade_val, gpa_val from public.grade_records
    where class_id = class_multi_id and student_id = student1_id;
  perform pg_temp.assert_eq('multi-item full scores: final grade', final_grade_val, 87.00::numeric);
  perform pg_temp.assert_eq('multi-item full scores: gpa (85-87.99 band)', gpa_val, 2.00::numeric);

  -- ---------------- partial input: weight_used < 100 => null ----------------
  insert into public.grade_records (class_id, student_id, activities, quizzes, projects, midterm_exam, final_exam)
  values (class_multi_id, student2_id, array[100,80], array[90,70], null, null, null); -- only 30% of weight present

  select computed_final_grade, gpa_equivalent into final_grade_val, gpa_val from public.grade_records
    where class_id = class_multi_id and student_id = student2_id;
  perform pg_temp.assert_eq('partial input: final grade is null', final_grade_val, null::numeric);
  perform pg_temp.assert_eq('partial input: gpa is null', gpa_val, null::numeric);

  -- ---------------- missing array index (item 2 not yet scored) ----------------
  update public.grade_records set activities = array[100], quizzes = array[90,70], projects = array[85],
    midterm_exam = 88, final_exam = 92
  where class_id = class_multi_id and student_id = student2_id;
  -- Act 2 (5%) missing => only 95% of weight used => still incomplete => null
  select computed_final_grade into final_grade_val from public.grade_records
    where class_id = class_multi_id and student_id = student2_id;
  perform pg_temp.assert_eq('missing single item keeps weight_used < 100: final grade null', final_grade_val, null::numeric);

  -- fill in the missing item -> now complete
  update public.grade_records set activities = array[100,80]
  where class_id = class_multi_id and student_id = student2_id;
  select computed_final_grade into final_grade_val from public.grade_records
    where class_id = class_multi_id and student_id = student2_id;
  perform pg_temp.assert_eq('completing the missing item triggers recompute: final grade', final_grade_val, 87.00::numeric);

  -- ============================================================
  -- TEST GROUP 2: legacy fallback (grade_components IS NULL)
  -- grade_weights defaults to 20/20/20/20/20 (table default).
  -- activities avg([80,90])=85, quizzes avg([70])=70, projects avg([100])=100,
  -- midterm=90, final=80
  -- Expected = 85*.2 + 70*.2 + 100*.2 + 90*.2 + 80*.2 = 17+14+20+18+16 = 85
  -- ============================================================
  insert into public.classes (subject_id, section_id, faculty_id, academic_year_id, semester_id)
  values (subj_id, sect_id, faculty_id, ayr_id, sem_id) -- grade_components left NULL
  returning id into class_legacy_id;

  insert into public.grade_records (class_id, student_id, activities, quizzes, projects, midterm_exam, final_exam)
  values (class_legacy_id, student1_id, array[80,90], array[70], array[100], 90, 80);

  select computed_final_grade, gpa_equivalent into final_grade_val, gpa_val from public.grade_records
    where class_id = class_legacy_id and student_id = student1_id;
  perform pg_temp.assert_eq('legacy fallback: final grade', final_grade_val, 85.00::numeric);
  perform pg_temp.assert_eq('legacy fallback: gpa (85-87 band)', gpa_val, 2.00::numeric);

  -- ============================================================
  -- TEST GROUP 3: weight-change recompute (simulates recomputeExistingGrades)
  -- ============================================================
  update public.classes set grade_components = jsonb_build_object(
    'activities', jsonb_build_array(jsonb_build_object('label','Act 1','weight',50)),
    'quizzes', jsonb_build_array(),
    'projects', jsonb_build_array(),
    'midtermExam', jsonb_build_object('label','Midterm','weight',50),
    'finalExam', jsonb_build_object('label','Final','weight',0)
  ) where id = class_multi_id;

  -- no-op update to re-fire the trigger, same technique the app uses after a weight edit
  update public.grade_records set updated_at = now() where class_id = class_multi_id and student_id = student1_id;
  -- Act1=100 (50%) + Midterm=88 (50%) = 50 + 44 = 94; weight_used = 100
  select computed_final_grade into final_grade_val from public.grade_records
    where class_id = class_multi_id and student_id = student1_id;
  perform pg_temp.assert_eq('recompute after weight change reflects new config', final_grade_val, 94.00::numeric);

  raise notice '=== All assertions passed ===';

  -- ---------------- cleanup ----------------
  delete from public.grade_records where class_id in (class_multi_id, class_legacy_id);
  delete from public.classes where id in (class_multi_id, class_legacy_id);
  delete from public.sections where id = sect_id;
  delete from public.subjects where id = subj_id;
  delete from public.semesters where id = sem_id;
  delete from public.academic_years where id = ayr_id;
  delete from public.profiles where id in (faculty_id, student1_id, student2_id);
  delete from auth.users where id in (faculty_id, student1_id, student2_id);

exception when others then
  -- Best-effort cleanup even on failure, then re-raise so the test run fails loudly.
  delete from public.grade_records where class_id in (class_multi_id, class_legacy_id);
  delete from public.classes where id in (class_multi_id, class_legacy_id);
  delete from public.sections where id = sect_id;
  delete from public.subjects where id = subj_id;
  delete from public.semesters where id = sem_id;
  delete from public.academic_years where id = ayr_id;
  delete from public.profiles where id in (faculty_id, student1_id, student2_id);
  delete from auth.users where id in (faculty_id, student1_id, student2_id);
  raise;
end $$;
