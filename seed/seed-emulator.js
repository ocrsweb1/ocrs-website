/**
 * LOCAL-ONLY test data seeder — for use with `supabase start` (the
 * Supabase CLI's local dev stack), not a hosted project.
 *
 * Creates a full set of test accounts (known passwords!) plus a sample
 * class with enrollments, grades, and attendance already filled in, so
 * you can click around all three dashboards without deploying anything.
 *
 * Usage:
 *   1. supabase start        (from the project root — needs supabase/config.toml)
 *   2. supabase db reset     (applies supabase/migrations/0001_init.sql)
 *   3. cd seed && npm install
 *   4. node seed-emulator.js
 *      (uses the well-known local Supabase CLI demo keys by default; if
 *      `supabase status` prints different values for your CLI version,
 *      pass them explicitly: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node seed-emulator.js)
 *   5. Serve the site locally (e.g. `npx serve .` from the project root)
 *      and open it with ?local=1, e.g. http://localhost:3000/index.html?local=1
 */

const { createClient } = require("@supabase/supabase-js");

// Standard Supabase CLI local-dev values — same on every machine unless
// you've customized supabase/config.toml. Override via env vars if needed.
const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const PASSWORD = "Test1234!"; // same password for every seeded test account, for convenience

const TEST_ACCOUNTS = [
  { role: "admin", email: "admin@slsu.test", fullName: "Ana Reyes (Admin)" },
  { role: "faculty", email: "faculty1@slsu.test", fullName: "Prof. Jose Dela Cruz", employeeNumber: "EMP-2041" },
  { role: "faculty", email: "faculty2@slsu.test", fullName: "Prof. Liza Marquez", employeeNumber: "EMP-2077" },
  { role: "student", email: "student1@slsu.test", fullName: "Miguel Santos", studentNumber: "23-01452", program: "BSIT", yearLevel: "2nd Year", section: "BSIT-2A" },
  { role: "student", email: "student2@slsu.test", fullName: "Bea Fernandez", studentNumber: "23-01489", program: "BSIT", yearLevel: "2nd Year", section: "BSIT-2A" },
  { role: "student", email: "student3@slsu.test", fullName: "Carlo Villanueva", studentNumber: "22-00981", program: "BSIT", yearLevel: "2nd Year", section: "BSIT-2A" },
];

async function upsertAccount(acct) {
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list?.users?.find((u) => u.email === acct.email);
  if (!user) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: acct.email, password: PASSWORD, email_confirm: true,
      user_metadata: { full_name: acct.fullName, role: acct.role },
    });
    if (error) throw error;
    user = created.user;
  }
  await admin.from("profiles").upsert({
    id: user.id, full_name: acct.fullName, email: acct.email, role: acct.role, status: "active",
    student_number: acct.studentNumber || null, employee_number: acct.employeeNumber || null,
    program: acct.program || null, year_level: acct.yearLevel || null, section: acct.section || null,
  });
  return user.id;
}

async function main() {
  console.log(`Seeding ${TEST_ACCOUNTS.length} test accounts into local Supabase…`);
  const uids = {};
  for (const acct of TEST_ACCOUNTS) uids[acct.email] = await upsertAccount(acct);

  const { data: ayr } = await admin.from("academic_years").insert({ year: "2026-2027", is_active: true }).select().single();
  const { data: sem } = await admin.from("semesters").insert({ name: "1st Semester", academic_year_id: ayr.id, is_active: true }).select().single();
  const { data: subj } = await admin.from("subjects").insert({ code: "IT102", title: "Computer Programming 1", units: 3, program: "BSIT" }).select().single();
  const { data: sect } = await admin.from("sections").insert({ name: "BSIT-2A", program: "BSIT", year_level: "2nd Year" }).select().single();

  const facultyUid = uids["faculty1@slsu.test"];
  const { data: cls } = await admin.from("classes").insert({
    faculty_id: facultyUid, subject_id: subj.id, section_id: sect.id,
    academic_year_id: ayr.id, semester_id: sem.id,
    // Per-item grading: 2 activities (5% each), 2 quizzes (10% each),
    // 1 project (20%), midterm (20%), final (25%) = 100%. Demonstrates
    // the multi-item model, not just the single-item migration default.
    grade_components: {
      activities: [{ label: "Act 1", weight: 5 }, { label: "Act 2", weight: 5 }],
      quizzes: [{ label: "Quiz 1", weight: 10 }, { label: "Quiz 2", weight: 10 }],
      projects: [{ label: "Project", weight: 20 }],
      midtermExam: { label: "Midterm", weight: 25 },
      finalExam: { label: "Final", weight: 25 },
    },
    locked: false, status: "active",
  }).select().single();

  const students = [
    { email: "student1@slsu.test", activities: [88, 90], quizzes: [85, 92], projects: [90], midtermExam: 87, finalExam: 91 },
    { email: "student2@slsu.test", activities: [95, 93], quizzes: [90, 88], projects: [94], midtermExam: 92, finalExam: 90 },
    { email: "student3@slsu.test", activities: [70, 65], quizzes: [68, 72], projects: [66], midtermExam: 70, finalExam: 65 }, // at-risk example
  ];

  for (const s of students) {
    const studentUid = uids[s.email];
    await admin.from("enrollments").upsert(
      { class_id: cls.id, student_id: studentUid, status: "active", enrolled_by: facultyUid },
      { onConflict: "class_id,student_id" }
    );

    // computed_final_grade / gpa_equivalent are recalculated automatically by the
    // compute_grade_record() trigger the moment this row is inserted — we don't
    // set them here ourselves.
    await admin.from("grade_records").upsert({
      class_id: cls.id, student_id: studentUid,
      activities: s.activities, quizzes: s.quizzes, projects: s.projects,
      midterm_exam: s.midtermExam, final_exam: s.finalExam, updated_by: facultyUid,
    }, { onConflict: "class_id,student_id" });

    for (const [daysAgo, status] of [[7, "present"], [4, "present"], [2, "late"]]) {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      const dateStr = date.toISOString().slice(0, 10);
      await admin.from("attendance_records").upsert({
        class_id: cls.id, student_id: studentUid, date: dateStr, status, remarks: "", recorded_by: facultyUid,
      }, { onConflict: "class_id,student_id,date" });
    }
  }

  console.log("\n✔ Done. Test accounts (all use the same password):\n");
  console.log(`  Password for every account below: ${PASSWORD}\n`);
  console.table(TEST_ACCOUNTS.map(({ role, email, fullName }) => ({ role, email, fullName })));
  console.log(`\nOpen the app with ?local=1 and sign in with any of the above.`);
}

main().catch((err) => {
  console.error("Emulator seed failed:", err);
  process.exit(1);
});
