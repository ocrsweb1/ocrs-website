# OCRS — Online Class Record & Academic Monitoring System
Southern Luzon State University — Lucena Campus

A cloud-based replacement for manual grade sheets and scattered spreadsheets.
**Backend: Supabase** (Postgres + Auth + Edge Functions). **Hosting: Netlify**
(plain static HTML/CSS/JS, no build step — deploy by pointing Netlify at the
repo root).

## What's in this codebase

```
index.html                 Login (role-tabbed: student / faculty / admin)
student.html + js/student.js     Student dashboard
faculty.html + js/faculty.js     Faculty dashboard
admin.html   + js/admin.js       Administrator dashboard
css/styles.css              Shared design system (SLSU green/white/gold)
js/supabase-config.js       Supabase client init — put your project URL/anon key here
js/auth.js                  Sign-in / sign-out / route guarding
js/utils.js                 Formatting, GPA math, CSV export, the "seal gauge"

supabase/migrations/0001_init.sql   Tables, Row Level Security policies,
                                     helper functions, grade-computation trigger
supabase/functions/*/index.ts       Edge Functions (account mgmt, locking, audit log)
supabase/config.toml                Local Supabase CLI configuration

netlify.toml                Netlify hosting configuration
seed/seed.js                 One-time script: create the first admin (hosted project)
seed/seed-emulator.js        Test-data script for local `supabase start`
```

## Why Supabase + Netlify instead of Firebase

| Firebase concept        | Supabase / Netlify equivalent                     |
|--------------------------|-----------------------------------------------------|
| Firestore                | Postgres (`supabase/migrations/0001_init.sql`)      |
| Firestore Security Rules | Row Level Security policies (same file)             |
| Firebase Auth            | Supabase Auth (email/password)                      |
| Cloud Functions          | Supabase Edge Functions (Deno, `supabase/functions/`) |
| Firebase Hosting         | Netlify                                              |

The access-control model is identical in spirit: students are read-only on
their own rows, faculty can only touch their own classes and only while
unlocked, and the fields that matter most — computed final grades, GPA,
and the lock flag — can never be set directly by a client no matter who
they are. In Postgres this is enforced by a couple of triggers instead of
Firestore's field-level rule checks (see the comments at the top of
`0001_init.sql` for exactly how).

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick a region
   close to your users (e.g. Singapore for the Philippines) and set a strong
   database password (save it somewhere safe).
2. Once it's provisioned, open **SQL Editor** and run the contents of
   `supabase/migrations/0001_init.sql` (paste the whole file in and click
   Run). This creates every table, RLS policy, and trigger in one go.
   - Alternatively, with the Supabase CLI linked to your project:
     ```bash
     supabase link --project-ref YOUR_PROJECT_REF
     supabase db push
     ```
3. **Authentication → Providers**: make sure Email is enabled. Under
   **Authentication → Settings**, turn **off** "Allow new users to sign up" —
   OCRS has no public registration; every account is created by an admin.
4. **Project Settings → API**: copy the **Project URL** and the **anon
   public** key — you'll need these next. Also copy the **service_role**
   secret key, but keep it out of the frontend entirely (it's only used by
   the seed script and, indirectly, by the Edge Functions once deployed).

## 2. Wire up the frontend

Paste the Project URL and anon key from step 1 into `js/supabase-config.js`:

```js
const SUPABASE_URL = "https://your-project-ref.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-public-key";
```

The anon key is safe to expose publicly — it identifies your project and is
constrained entirely by the Row Level Security policies in
`0001_init.sql`; it authorizes nothing by itself.

## 3. Deploy the Edge Functions

Install the Supabase CLI and log in:

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy all five functions:

```bash
supabase functions deploy create-user-account
supabase functions deploy set-user-status
supabase functions deploy lock-class-grades
supabase functions deploy unlock-class-grades
supabase functions deploy generate-report
```

These run with your project's service role key automatically (Supabase
injects `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`
into the Edge Function environment for you — no manual secret setup
needed).

> **CORS note:** `supabase/functions/_shared/helpers.ts` sets
> `Access-Control-Allow-Origin: *` by default so it works immediately.
> Once you know your Netlify URL, tighten this to that exact origin.

## 4. Create the first administrator account

There's no public sign-up, so bootstrap the first admin with the service
role key, locally:

```bash
cd seed
npm install
SUPABASE_URL=https://vlyhswezqzsgxwyclbsq.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZseWhzd2V6cXpzZ3h3eWNsYnNxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzc2MjcwOCwiZXhwIjoyMDk5MzM4NzA4fQ.x5R8_QabF_JAxSWzOVcn5N2fgDL1XxHfkIRkNQ7I0TU \
  ADMIN_EMAIL=registrar@slsu.edu.ph \
  ADMIN_PASSWORD='pass123' \
  ADMIN_NAME='Registrar Administrator' \
  node seed.js
```

This also seeds one academic year, one semester, and a few sample subjects
and sections so the Administrator dashboard isn't empty on first login.

## 5. Deploy the site to Netlify

**Option A — drag and drop (fastest):**
Go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag the
project folder in. Done — Netlify serves `index.html`, `student.html`,
etc. directly since there's no build step.

**Option B — connect your Git repo (recommended for ongoing changes):**
1. Push this project to a GitHub/GitLab repo.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
3. Build command: leave as `echo 'No build step...'` (already set in
   `netlify.toml`). Publish directory: `.` (already set).
4. Deploy. Netlify gives you a `https://your-site.netlify.app` URL.

**Option C — Netlify CLI:**
```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod
```

Once you have your Netlify URL, go back to Supabase → Authentication →
URL Configuration and set the **Site URL** to that Netlify URL (needed for
password-reset email links to work correctly).

Visit the Netlify URL, sign in as the admin account you just created, and
start creating faculty and student accounts from **Accounts** in the admin
dashboard.

---

## Local development

**Supabase local stack:**
```bash
supabase start          # spins up local Postgres, Auth, Edge Functions, Studio
supabase db reset        # applies supabase/migrations/0001_init.sql
```

**Seed local test data:**
```bash
cd seed
npm install
node seed-emulator.js
```

**Serve the frontend locally:**
```bash
npx serve .
# open http://localhost:3000/index.html?local=1
```

The `?local=1` query param tells `js/supabase-config.js` to talk to your
local Supabase stack (`http://127.0.0.1:54321`) instead of your hosted
project. Supabase Studio (a local dashboard) is available at
`http://127.0.0.1:54323` while `supabase start` is running.

**Serve Edge Functions locally too** (optional — only needed if you're
testing account creation / locking / unlocking without deploying):
```bash
supabase functions serve
```

### Test accounts for local testing

`node seed-emulator.js` creates these accounts, all sharing one password,
plus a sample class with enrollments, grades, and attendance already
filled in:

| Role    | Email                  | Password     | Notes                          |
|---------|-------------------------|--------------|---------------------------------|
| Admin   | `admin@slsu.test`       | `Test1234!`  | Full access                     |
| Faculty | `faculty1@slsu.test`    | `Test1234!`  | Owns the sample IT102 class     |
| Faculty | `faculty2@slsu.test`    | `Test1234!`  | No classes yet — good for testing "New Class" |
| Student | `student1@slsu.test`    | `Test1234!`  | Final grade ~90 (passing)       |
| Student | `student2@slsu.test`    | `Test1234!`  | Final grade ~91 (passing)       |
| Student | `student3@slsu.test`    | `Test1234!`  | Final grade ~68 (at-risk example, shows the warning banner) |

This script only ever talks to your local Supabase stack (`127.0.0.1`), so
these known passwords can't end up in a real deployment. Re-running it is
safe — it upserts rather than duplicating accounts.

---

## How the roles actually work

**There is no public registration.** An Administrator creates every account
(student, faculty, or admin) from the Accounts screen, which calls the
`create-user-account` Edge Function. That function creates the Supabase
Auth user *and* the matching `profiles` row together, and sets a temporary
password the admin shares with the person.

**Student** — read-only everywhere. RLS restricts every table to rows
where `student_id = auth.uid()`. There's no INSERT/UPDATE policy for
students on `grade_records` or `attendance_records` at all.

**Faculty** — can create classes assigned to themselves, manage their
class rosters, encode raw component scores (activities/quizzes/projects/
midterm/final), and lock a grade sheet when done. They can never make
`computed_final_grade`, `gpa_equivalent`, or `classes.locked` say
anything other than what the server computes/permits — see below.

**Administrator** — manages accounts, academic structure (years,
semesters, subjects, sections), monitors encoding completion across all
classes, can unlock a locked grade sheet (must supply a reason, written to
`audit_logs`), and can generate CSV reports.

### Why final grades and GPA can't be edited directly

`compute_grade_record()` is a `BEFORE INSERT OR UPDATE` trigger on
`grade_records`. Every time a row is written — no matter what a client
sent for `computed_final_grade` / `gpa_equivalent` — the trigger
recalculates both from the raw score columns and the owning class's
`grade_weights`, and overwrites whatever was submitted. There's no RLS
rule to bypass here because the value literally cannot exist any other
way; it's computed server-side, always.

### Why locking works the way it does

- Faculty can **lock** their own class's grade sheet by calling the
  `lock-class-grades` Edge Function.
- Only an **Administrator** can **unlock** it, via `unlock-class-grades`,
  and must type a reason — satisfying "unlock only when necessary, every
  action recorded in an audit log."
- A trigger (`block_direct_lock_change`) raises an exception if any
  client (`auth.role() = 'authenticated'`) tries to change
  `classes.locked` through an ordinary `UPDATE` — even an admin, even
  faculty. Both Edge Functions use the **service role** key, which runs as
  the `postgres` role and skips that trigger's check, so locking/unlocking
  can only ever happen through those two audited code paths.

## Database schema

```
profiles                id (= auth.users.id), full_name, email, role, status,
                          student_number | employee_number, program, year_level, section
academic_years            id, year, is_active
semesters                  id, name, academic_year_id, is_active
subjects                   id, code, title, units, program
sections                   id, name, program, year_level
classes                     id, subject_id, section_id, faculty_id, academic_year_id,
                             semester_id, grade_weights (jsonb), locked, status
enrollments                 id, class_id, student_id, status — unique (class_id, student_id)
grade_records                id, class_id, student_id, activities[], quizzes[], projects[],
                              midterm_exam, final_exam, computed_final_grade, gpa_equivalent
                              — unique (class_id, student_id); last 2 columns are
                              trigger-computed, never client-writable
attendance_records            id, class_id, student_id, date, status, remarks
                               — unique (class_id, student_id, date)
reports                        id, type, generated_by, generated_at
audit_logs                      id, action, performed_by, target_table, target_id, details, created_at
```

`grade_records` and `attendance_records` use a real unique constraint on
`(class_id, student_id[, date])` instead of Firestore's deterministic
document-ID trick — `upsert(..., { onConflict: "class_id,student_id" })`
from the client does the same job of "one row per student per class."

## Extending this

- **Tighten CORS**: once you have your Netlify URL, edit
  `Access-Control-Allow-Origin` in `supabase/functions/_shared/helpers.ts`
  from `*` to your exact site URL and redeploy the functions.
- **Realtime**: `0001_init.sql` already adds `grade_records`, `classes`,
  and `attendance_records` to the `supabase_realtime` publication — you
  can subscribe to live changes with `supabase.channel(...)` if you want
  the student dashboard to update without a refresh when faculty save
  grades.
- **Storage**: Supabase Storage buckets + policies work the same way as
  the tables here (`storage.objects` also supports RLS) if you want to add
  document uploads (e.g. COR, medical certificates) later.
- **Scheduled digest**: `pg_cron` (a Supabase extension) can run a SQL
  function nightly to flag classes with incomplete grade sheets close to
  a grading-period deadline, instead of a scheduled Cloud Function.
#   o c r s - w e b s i t e  
 