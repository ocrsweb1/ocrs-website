-- ============================================================
-- OCRS — Migration 0002: per-item grade components
--
-- Replaces the category-average grading model (one weight for the
-- average of all activities, one for all quizzes, etc.) with a
-- configurable list of named, individually-weighted items per class:
-- "Act 1" (5%), "Act 2" (5%), "Quiz 1" (10%), etc.
--
-- Backward compatible: classes.grade_weights is left in place and
-- untouched; classes.grade_components (new) is what the trigger reads
-- from now on. Any class where grade_components is NULL falls back to
-- the original category-average behavior using grade_weights, so a
-- class you never touch keeps computing grades exactly as before.
-- ============================================================

-- ---------------- 1. New column ----------------

alter table public.classes
  add column if not exists grade_components jsonb default null;

comment on column public.classes.grade_components is
  'Per-item grading config, e.g. {"activities":[{"label":"Act 1","weight":5}, ...], "midtermExam":{"label":"Midterm Exam","weight":20}, ...}. NULL means "use legacy grade_weights category-average behavior".';

-- ---------------- 2. Replace the trigger function ----------------

drop trigger if exists trg_compute_grade_record on public.grade_records;

create or replace function public.compute_grade_record()
returns trigger language plpgsql as $$
declare
  comps jsonb;
  legacy_w jsonb;
  weighted_sum numeric := 0;
  weight_used numeric := 0;
  final_grade numeric;

  -- per-item mode working variables
  items jsonb;
  item jsonb;
  idx integer;
  item_weight numeric;
  item_value numeric;

  -- legacy (category-average) mode working variables
  w_activities numeric; w_quizzes numeric; w_projects numeric; w_midterm numeric; w_final numeric;
  avg_activities numeric; avg_quizzes numeric; avg_projects numeric;
begin
  select grade_components, grade_weights into comps, legacy_w
  from public.classes where id = new.class_id;

  if comps is not null then
    -- ============================================================
    -- PER-ITEM MODE
    -- Each configured item is matched by array position (1-based Postgres
    -- array index = 0-based jsonb array index + 1) to the corresponding
    -- element of new.activities / new.quizzes / new.projects. A missing
    -- array element (student not yet scored on that item) is skipped —
    -- its weight is simply not counted toward weight_used.
    -- ============================================================

    -- activities
    items := comps->'activities';
    if items is not null then
      for idx in 0 .. jsonb_array_length(items) - 1 loop
        item := items->idx;
        item_weight := coalesce((item->>'weight')::numeric, 0);
        if new.activities is not null and array_length(new.activities, 1) > idx and new.activities[idx + 1] is not null then
          item_value := new.activities[idx + 1];
          weighted_sum := weighted_sum + item_value * (item_weight / 100.0);
          weight_used := weight_used + item_weight;
        end if;
      end loop;
    end if;

    -- quizzes
    items := comps->'quizzes';
    if items is not null then
      for idx in 0 .. jsonb_array_length(items) - 1 loop
        item := items->idx;
        item_weight := coalesce((item->>'weight')::numeric, 0);
        if new.quizzes is not null and array_length(new.quizzes, 1) > idx and new.quizzes[idx + 1] is not null then
          item_value := new.quizzes[idx + 1];
          weighted_sum := weighted_sum + item_value * (item_weight / 100.0);
          weight_used := weight_used + item_weight;
        end if;
      end loop;
    end if;

    -- projects
    items := comps->'projects';
    if items is not null then
      for idx in 0 .. jsonb_array_length(items) - 1 loop
        item := items->idx;
        item_weight := coalesce((item->>'weight')::numeric, 0);
        if new.projects is not null and array_length(new.projects, 1) > idx and new.projects[idx + 1] is not null then
          item_value := new.projects[idx + 1];
          weighted_sum := weighted_sum + item_value * (item_weight / 100.0);
          weight_used := weight_used + item_weight;
        end if;
      end loop;
    end if;

    -- midtermExam (single item)
    if comps->'midtermExam' is not null then
      item_weight := coalesce((comps->'midtermExam'->>'weight')::numeric, 0);
      if new.midterm_exam is not null then
        weighted_sum := weighted_sum + new.midterm_exam * (item_weight / 100.0);
        weight_used := weight_used + item_weight;
      end if;
    end if;

    -- finalExam (single item)
    if comps->'finalExam' is not null then
      item_weight := coalesce((comps->'finalExam'->>'weight')::numeric, 0);
      if new.final_exam is not null then
        weighted_sum := weighted_sum + new.final_exam * (item_weight / 100.0);
        weight_used := weight_used + item_weight;
      end if;
    end if;

  else
    -- ============================================================
    -- LEGACY FALLBACK MODE (grade_components is null on this class)
    -- Identical to the original 0001 migration: average each category's
    -- array, weight by classes.grade_weights.
    -- ============================================================
    w_activities := coalesce((legacy_w->>'activities')::numeric, 20);
    w_quizzes    := coalesce((legacy_w->>'quizzes')::numeric, 20);
    w_projects   := coalesce((legacy_w->>'projects')::numeric, 20);
    w_midterm    := coalesce((legacy_w->>'midtermExam')::numeric, 20);
    w_final      := coalesce((legacy_w->>'finalExam')::numeric, 20);

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
  end if;

  -- ---------------- shared final-grade / GPA logic ----------------
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

-- ---------------- 3. Backfill existing classes ----------------
-- Minimal-risk mapping: one item per category, named after the category,
-- carrying over that category's existing weight verbatim. This produces
-- grade_components that behaves identically to the old category-average
-- trigger UNLESS a class had more than one activity/quiz/project score —
-- in that case the single item only reads the FIRST array element (see
-- README "Migration notes" for why, and how to fan a class out into
-- multiple items instead if it actually needs them).

update public.classes
set grade_components = jsonb_build_object(
  'activities', jsonb_build_array(jsonb_build_object('label', 'Activities', 'weight', coalesce((grade_weights->>'activities')::numeric, 20))),
  'quizzes',    jsonb_build_array(jsonb_build_object('label', 'Quizzes',    'weight', coalesce((grade_weights->>'quizzes')::numeric, 20))),
  'projects',   jsonb_build_array(jsonb_build_object('label', 'Projects',   'weight', coalesce((grade_weights->>'projects')::numeric, 20))),
  'midtermExam', jsonb_build_object('label', 'Midterm Exam', 'weight', coalesce((grade_weights->>'midtermExam')::numeric, 20)),
  'finalExam',   jsonb_build_object('label', 'Final Exam',   'weight', coalesce((grade_weights->>'finalExam')::numeric, 20))
)
where grade_components is null;

-- ---------------- 4. Force a recompute pass ----------------
-- A no-op UPDATE re-fires the BEFORE UPDATE trigger for every existing
-- grade_records row, so computed_final_grade / gpa_equivalent reflect
-- the (identical, by construction above) per-item math immediately
-- rather than waiting for the next time a faculty member edits a score.

update public.grade_records set updated_at = now();
