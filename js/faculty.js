import { supabase } from "./supabase-config.js";
import { guardPage, logout } from "./auth.js";
import {
  $, $all, toast, initials, DEFAULT_WEIGHTS, computeWeightedFinal, remarkFor, downloadCSV,
} from "./utils.js";

let PROFILE = null;
let STATE = {
  classes: [], subjects: {}, sections: {}, academicYears: [], semesters: [],
  enrollmentsByClass: {}, studentsById: {}, gradeRecordsByClass: {},
};

guardPage("faculty", async (profile) => {
  PROFILE = profile;
  renderShell();
  wireNav();
  wireModals();
  await loadEverything();
  renderOverview();
  renderClassesGrid();
  populateClassSelects();
});

$("#signout-btn").addEventListener("click", logout);
$("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

function renderShell() {
  $("#user-avatar").textContent = initials(PROFILE.full_name || PROFILE.email);
  $("#user-name").textContent = PROFILE.full_name || PROFILE.email;
}

function wireNav() {
  $all(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      $all(".nav-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      $all(".view").forEach((v) => (v.style.display = "none"));
      $(`#view-${item.dataset.view}`).style.display = "block";
      $("#page-title").textContent = {
        overview: "Teaching Overview", classes: "My Classes", encoding: "Grade Encoding",
        attendance: "Attendance", export: "Export Records",
      }[item.dataset.view];
      $("#new-class-btn").style.display = item.dataset.view === "classes" ? "inline-flex" : "none";
      $("#sidebar").classList.remove("open");
    });
  });
}

async function loadEverything() {
  const { data: classes } = await supabase.from("classes").select("*").eq("faculty_id", PROFILE.uid);
  STATE.classes = classes || [];

  const [{ data: subjects }, { data: sections }, { data: years }, { data: sems }] = await Promise.all([
    supabase.from("subjects").select("*"),
    supabase.from("sections").select("*"),
    supabase.from("academic_years").select("*"),
    supabase.from("semesters").select("*"),
  ]);
  (subjects || []).forEach((s) => (STATE.subjects[s.id] = s));
  (sections || []).forEach((s) => (STATE.sections[s.id] = s));
  STATE.academicYears = years || [];
  STATE.semesters = sems || [];

  const classIds = STATE.classes.map((c) => c.id);
  if (classIds.length) {
    const [{ data: enrollments }, { data: grades }] = await Promise.all([
      supabase.from("enrollments").select("*").in("class_id", classIds),
      supabase.from("grade_records").select("*").in("class_id", classIds),
    ]);
    for (const cls of STATE.classes) {
      STATE.enrollmentsByClass[cls.id] = (enrollments || []).filter((e) => e.class_id === cls.id);
      STATE.gradeRecordsByClass[cls.id] = (grades || []).filter((g) => g.class_id === cls.id);
    }
    const studentIds = [...new Set((enrollments || []).map((e) => e.student_id))];
    if (studentIds.length) {
      const { data: students } = await supabase.from("profiles").select("*").in("id", studentIds);
      (students || []).forEach((s) => (STATE.studentsById[s.id] = s));
    }
  }
}

function classLabel(cls) {
  const subj = STATE.subjects[cls.subject_id] || {};
  const sect = STATE.sections[cls.section_id] || {};
  return `${subj.code || "—"} · ${sect.name || "—"}`;
}

function completionFor(cls) {
  const roster = STATE.enrollmentsByClass[cls.id] || [];
  const grades = STATE.gradeRecordsByClass[cls.id] || [];
  const complete = grades.filter((g) => g.computed_final_grade !== null && g.computed_final_grade !== undefined).length;
  return { total: roster.length, complete, pct: roster.length ? Math.round((complete / roster.length) * 100) : 0 };
}

function renderOverview() {
  const totalStudents = new Set(Object.values(STATE.enrollmentsByClass).flat().map((e) => e.student_id)).size;
  const lockedCount = STATE.classes.filter((c) => c.locked).length;
  const avgCompletion = STATE.classes.length
    ? Math.round(STATE.classes.reduce((sum, c) => sum + completionFor(c).pct, 0) / STATE.classes.length) : 0;

  $("#overview-stats").innerHTML = `
    <div class="card stat-card"><div class="label">My Classes</div><div class="value">${STATE.classes.length}</div></div>
    <div class="card stat-card"><div class="label">Total Students</div><div class="value">${totalStudents}</div></div>
    <div class="card stat-card"><div class="label">Avg. Encoding Progress</div><div class="value">${avgCompletion}%</div></div>
    <div class="card stat-card"><div class="label">Locked Classes</div><div class="value">${lockedCount}</div></div>`;

  $("#completion-list").innerHTML = STATE.classes.length ? STATE.classes.map((cls) => {
    const c = completionFor(cls);
    return `<div style="margin-bottom:14px">
      <div class="flex" style="justify-content:space-between;margin-bottom:6px">
        <span style="font-size:13.5px;font-weight:600">${classLabel(cls)}</span>
        <span class="subtle">${c.complete}/${c.total} encoded</span>
      </div>
      <div class="progress"><div style="width:${c.pct}%"></div></div>
    </div>`;
  }).join("") : `<div class="empty-state">No classes yet. Create one to get started.</div>`;
}

function renderClassesGrid() {
  $("#classes-grid").innerHTML = STATE.classes.length ? STATE.classes.map((cls) => {
    const c = completionFor(cls);
    return `<div class="card">
      <div class="card-header">
        <div><h3>${classLabel(cls)}</h3><span class="subtle">${STATE.academicYears.find(y=>y.id===cls.academic_year_id)?.year || ""} · ${STATE.semesters.find(s=>s.id===cls.semester_id)?.name || ""}</span></div>
        <span class="badge ${cls.locked ? "badge-amber" : "badge-green"}"><span class="dot"></span>${cls.locked ? "Locked" : "Open"}</span>
      </div>
      <p class="subtle">${c.total} enrolled · ${c.pct}% grades encoded</p>
      <div class="progress" style="margin-bottom:12px"><div style="width:${c.pct}%"></div></div>
      <div class="flex gap-8">
        <button class="btn btn-outline btn-sm" data-goto-encoding="${cls.id}">Encode Grades</button>
        <button class="btn btn-outline btn-sm" data-goto-attendance="${cls.id}">Attendance</button>
        <button class="btn btn-outline btn-sm" data-manage-roster="${cls.id}">Roster</button>
      </div>
    </div>`;
  }).join("") : `<div class="empty-state" style="grid-column:1/-1">No classes yet. Click "+ New Class" to create your first class record.</div>`;

  $all("[data-manage-roster]").forEach((btn) => btn.addEventListener("click", () => openRosterModal(btn.dataset.manageRoster)));

  $all("[data-goto-encoding]").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelector('.nav-item[data-view="encoding"]').click();
    $("#encoding-class-select").value = btn.dataset.gotoEncoding;
    $("#encoding-class-select").dispatchEvent(new Event("change"));
  }));
  $all("[data-goto-attendance]").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelector('.nav-item[data-view="attendance"]').click();
    $("#att-class-select").value = btn.dataset.gotoAttendance;
  }));
}

function populateClassSelects() {
  const opts = STATE.classes.map((c) => `<option value="${c.id}">${classLabel(c)}</option>`).join("");
  $("#encoding-class-select").innerHTML = `<option value="">Select a class…</option>` + opts;
  $("#att-class-select").innerHTML = `<option value="">Select a class…</option>` + opts;
  $("#export-class-select").innerHTML = `<option value="">Select a class…</option>` + opts;

  $("#nc-subject").innerHTML = Object.values(STATE.subjects).map((s) => `<option value="${s.id}">${s.code} — ${s.title}</option>`).join("");
  $("#nc-section").innerHTML = Object.values(STATE.sections).map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  $("#nc-year").innerHTML = STATE.academicYears.map((y) => `<option value="${y.id}">${y.year}</option>`).join("");
  $("#nc-semester").innerHTML = STATE.semesters.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");

  $("#encoding-class-select").addEventListener("change", renderEncodingTable);
}

// ---------- Modals wiring ----------
function wireModals() {
  $all("[data-close]").forEach((btn) => btn.addEventListener("click", () => {
    btn.closest(".modal-overlay").classList.remove("open");
  }));
  $("#new-class-btn").addEventListener("click", () => $("#class-modal").classList.add("open"));

  $("#nc-create-btn").addEventListener("click", async () => {
    const payload = {
      faculty_id: PROFILE.uid,
      subject_id: $("#nc-subject").value,
      section_id: $("#nc-section").value,
      academic_year_id: $("#nc-year").value,
      semester_id: $("#nc-semester").value,
      grade_weights: DEFAULT_WEIGHTS,
      locked: false,
      status: "active",
    };
    if (!payload.subject_id || !payload.section_id || !payload.academic_year_id || !payload.semester_id) {
      return toast("Please complete all fields.", "error");
    }
    const { data, error } = await supabase.from("classes").insert(payload).select().single();
    if (error) return toast(error.message || "Could not create class.", "error");
    STATE.classes.push(data);
    STATE.enrollmentsByClass[data.id] = [];
    STATE.gradeRecordsByClass[data.id] = [];
    $("#class-modal").classList.remove("open");
    renderOverview(); renderClassesGrid(); populateClassSelects();
    toast("Class created.");
  });

  $("#roster-add-btn").addEventListener("click", addToRoster);

  $("#weights-btn").addEventListener("click", () => {
    const classId = $("#encoding-class-select").value;
    if (!classId) return toast("Select a class first.", "error");
    const cls = STATE.classes.find((c) => c.id === classId);
    const w = cls.grade_weights || DEFAULT_WEIGHTS;
    ["activities", "quizzes", "projects", "midtermExam", "finalExam"].forEach((k) => ($(`#w-${k}`).value = w[k]));
    $("#weights-modal").classList.add("open");
  });

  $("#save-weights-btn").addEventListener("click", async () => {
    const classId = $("#encoding-class-select").value;
    const w = {
      activities: Number($("#w-activities").value) || 0,
      quizzes: Number($("#w-quizzes").value) || 0,
      projects: Number($("#w-projects").value) || 0,
      midtermExam: Number($("#w-midtermExam").value) || 0,
      finalExam: Number($("#w-finalExam").value) || 0,
    };
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    if (total !== 100) {
      $("#weights-error").textContent = `Weights must total 100% (currently ${total}%).`;
      $("#weights-error").classList.add("show");
      return;
    }
    const { error } = await supabase.from("classes").update({ grade_weights: w }).eq("id", classId);
    if (error) return toast(error.message || "Could not save weights.", "error");
    const cls = STATE.classes.find((c) => c.id === classId);
    cls.grade_weights = w;
    $("#weights-modal").classList.remove("open");
    toast("Grading weights updated. Final grades will recompute automatically.");
    // re-pull grade records so the recomputed values (done by the DB trigger on next write)
    // are reflected — weight changes alone don't retro-trigger existing rows, so nudge a re-save:
    await recomputeExistingGrades(classId, w);
    renderEncodingTable();
  });

  $("#lock-toggle-btn").addEventListener("click", async () => {
    const classId = $("#encoding-class-select").value;
    if (!classId) return;
    const cls = STATE.classes.find((c) => c.id === classId);
    if (cls.locked) return toast("Only an administrator can unlock a finalized grade sheet.", "error");
    if (!confirm("Lock this grade sheet? You won't be able to edit grades until an administrator unlocks it.")) return;
    const { data, error } = await supabase.functions.invoke("lock-class-grades", { body: { classId } });
    if (error) return toast(error.message || "Could not lock grade sheet.", "error");
    cls.locked = true;
    toast("Grade sheet locked.");
    renderEncodingTable();
    renderClassesGrid();
  });

  $("#save-encoding-btn").addEventListener("click", saveEncoding);
  $("#load-attendance-btn").addEventListener("click", renderAttendanceForm);
  $("#save-attendance-btn").addEventListener("click", saveAttendance);
  $("#export-grades-btn").addEventListener("click", exportGrades);
  $("#export-attendance-btn").addEventListener("click", exportAttendance);
}

// Postgres RE-computes on INSERT/UPDATE only — if weights change, existing
// rows need a no-op update to re-fire the trigger with the new weights.
async function recomputeExistingGrades(classId, weights) {
  const rows = STATE.gradeRecordsByClass[classId] || [];
  for (const g of rows) {
    await supabase.from("grade_records").update({ updated_at: new Date().toISOString() }).eq("id", g.id);
  }
  const { data: refreshed } = await supabase.from("grade_records").select("*").eq("class_id", classId);
  STATE.gradeRecordsByClass[classId] = refreshed || [];
}

// ---------- Roster ----------
function openRosterModal(classId) {
  $("#roster-modal").dataset.classId = classId;
  $("#roster-add-email").value = "";
  renderRosterList(classId);
  $("#roster-modal").classList.add("open");
}

function renderRosterList(classId) {
  const roster = STATE.enrollmentsByClass[classId] || [];
  $("#roster-list").innerHTML = roster.length ? roster.map((enr) => {
    const s = STATE.studentsById[enr.student_id] || {};
    return `<div class="flex" style="justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)">
      <div><b style="font-size:13px">${s.full_name || "—"}</b><br/><span class="subtle">${s.email || ""}</span></div>
      <button class="btn btn-outline btn-sm" data-remove-enr="${enr.id}">Remove</button>
    </div>`;
  }).join("") : `<div class="empty-state">No students enrolled yet.</div>`;

  $all("[data-remove-enr]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Remove this student from the class?")) return;
    const { error } = await supabase.from("enrollments").delete().eq("id", btn.dataset.removeEnr);
    if (error) return toast(error.message || "Could not remove student.", "error");
    const cid = $("#roster-modal").dataset.classId;
    STATE.enrollmentsByClass[cid] = (STATE.enrollmentsByClass[cid] || []).filter((e) => e.id !== btn.dataset.removeEnr);
    renderRosterList(cid);
    renderClassesGrid(); renderOverview(); renderEncodingTable();
    toast("Student removed from class.");
  }));
}

async function addToRoster() {
  const classId = $("#roster-modal").dataset.classId;
  const email = $("#roster-add-email").value.trim().toLowerCase();
  if (!email) return;
  const { data: matches, error: lookupErr } = await supabase.from("profiles").select("*")
    .eq("email", email).eq("role", "student").limit(1);
  if (lookupErr || !matches?.length) return toast("No active student account found with that email.", "error");

  const student = matches[0];
  STATE.studentsById[student.id] = student;
  const { data: enrollment, error } = await supabase.from("enrollments")
    .upsert({ class_id: classId, student_id: student.id, status: "active", enrolled_by: PROFILE.uid },
      { onConflict: "class_id,student_id" })
    .select().single();
  if (error) return toast(error.message || "Could not add student.", "error");

  STATE.enrollmentsByClass[classId] = STATE.enrollmentsByClass[classId] || [];
  if (!STATE.enrollmentsByClass[classId].some((e) => e.id === enrollment.id)) {
    STATE.enrollmentsByClass[classId].push(enrollment);
  }
  $("#roster-add-email").value = "";
  renderRosterList(classId);
  renderClassesGrid(); renderOverview(); renderEncodingTable();
  toast("Student added to class.");
}

// ---------- Grade Encoding ----------
function renderEncodingTable() {
  const classId = $("#encoding-class-select").value;
  const card = $("#encoding-card");
  const saveRow = $("#save-encoding-row");
  const lockBtn = $("#lock-toggle-btn");
  const banner = $("#encoding-locked-banner");

  if (!classId) { card.style.display = "none"; saveRow.style.display = "none"; lockBtn.style.display = "none"; banner.innerHTML = ""; return; }

  const cls = STATE.classes.find((c) => c.id === classId);
  const roster = STATE.enrollmentsByClass[classId] || [];
  const grades = STATE.gradeRecordsByClass[classId] || [];
  const weights = cls.grade_weights || DEFAULT_WEIGHTS;

  card.style.display = "block";
  saveRow.style.display = cls.locked ? "none" : "flex";
  lockBtn.style.display = "inline-flex";
  lockBtn.textContent = cls.locked ? "🔒 Locked (admin can unlock)" : "Lock Grade Sheet";
  lockBtn.disabled = cls.locked;
  banner.innerHTML = cls.locked
    ? `<div class="locked-banner">🔒 This grade sheet is locked. Contact an administrator to make further changes.</div>` : "";

  $("#encoding-tbody").innerHTML = roster.length ? roster.map((enr) => {
    const student = STATE.studentsById[enr.student_id] || {};
    const g = grades.find((gr) => gr.student_id === enr.student_id) || {};
    const preview = computeWeightedFinal({
      activities: g.activities, quizzes: g.quizzes, projects: g.projects,
      midtermExam: g.midterm_exam, finalExam: g.final_exam,
    }, weights);
    const remark = remarkFor(preview.finalGrade);
    const dis = cls.locked ? "disabled" : "";
    return `<tr data-student="${enr.student_id}">
      <td><b>${student.full_name || "—"}</b><br/><span class="subtle">${student.student_number || ""}</span></td>
      <td class="editable-cell num"><input type="text" ${dis} data-field="activities" value="${(g.activities||[]).join(",")}" /></td>
      <td class="editable-cell num"><input type="text" ${dis} data-field="quizzes" value="${(g.quizzes||[]).join(",")}" /></td>
      <td class="editable-cell num"><input type="text" ${dis} data-field="projects" value="${(g.projects||[]).join(",")}" /></td>
      <td class="editable-cell num"><input type="number" ${dis} data-field="midtermExam" value="${g.midterm_exam ?? ""}" /></td>
      <td class="editable-cell num"><input type="number" ${dis} data-field="finalExam" value="${g.final_exam ?? ""}" /></td>
      <td class="num mono preview-final" style="font-weight:700">${preview.finalGrade ?? "—"}</td>
      <td><span class="badge badge-${remark.tone}"><span class="dot"></span>${remark.label}</span></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8" class="empty-state">No students enrolled in this class yet.</td></tr>`;

  if (!cls.locked) {
    $all("#encoding-tbody input").forEach((input) => {
      input.addEventListener("input", () => {
        const row = input.closest("tr");
        const record = readRow(row);
        const preview = computeWeightedFinal(record, weights);
        const remark = remarkFor(preview.finalGrade);
        row.querySelector(".preview-final").textContent = preview.finalGrade ?? "—";
        const badge = row.querySelector(".badge");
        badge.className = `badge badge-${remark.tone}`;
        badge.innerHTML = `<span class="dot"></span>${remark.label}`;
      });
    });
  }
}

function readRow(row) {
  const parseList = (v) => v.split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
  return {
    activities: parseList(row.querySelector('[data-field="activities"]').value),
    quizzes: parseList(row.querySelector('[data-field="quizzes"]').value),
    projects: parseList(row.querySelector('[data-field="projects"]').value),
    midtermExam: row.querySelector('[data-field="midtermExam"]').value === "" ? null : Number(row.querySelector('[data-field="midtermExam"]').value),
    finalExam: row.querySelector('[data-field="finalExam"]').value === "" ? null : Number(row.querySelector('[data-field="finalExam"]').value),
  };
}

async function saveEncoding() {
  const classId = $("#encoding-class-select").value;
  if (!classId) return;
  const btn = $("#save-encoding-btn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const rows = $all("#encoding-tbody tr[data-student]");
    const payloads = rows.map((row) => {
      const studentId = row.dataset.student;
      const record = readRow(row);
      return {
        class_id: classId, student_id: studentId,
        activities: record.activities, quizzes: record.quizzes, projects: record.projects,
        midterm_exam: record.midtermExam, final_exam: record.finalExam,
        updated_by: PROFILE.uid, updated_at: new Date().toISOString(),
      };
    });
    // NOTE: computed_final_grade / gpa_equivalent are intentionally NOT sent —
    // the compute_grade_record() trigger (see supabase/migrations/0001_init.sql)
    // recomputes and overwrites those columns server-side on every insert/update.
    const { data, error } = await supabase.from("grade_records")
      .upsert(payloads, { onConflict: "class_id,student_id" })
      .select();
    if (error) throw error;
    STATE.gradeRecordsByClass[classId] = data;
    toast("Grades saved and final grades recomputed.");
    renderEncodingTable();
    renderOverview(); renderClassesGrid();
  } catch (e) {
    toast(e.message || "Could not save grades. The sheet may be locked.", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Save Grades";
  }
}

// ---------- Attendance ----------
function renderAttendanceForm() {
  const classId = $("#att-class-select").value;
  const dateVal = $("#att-date").value;
  if (!classId || !dateVal) return toast("Select a class and date.", "error");
  const roster = STATE.enrollmentsByClass[classId] || [];
  $("#attendance-card").style.display = "block";
  $("#save-attendance-row").style.display = "flex";
  $("#attendance-tbody").innerHTML = roster.map((enr) => {
    const student = STATE.studentsById[enr.student_id] || {};
    return `<tr data-student="${enr.student_id}">
      <td><b>${student.full_name || "—"}</b></td>
      <td>
        <select data-att-status>
          <option value="present">Present</option>
          <option value="late">Late</option>
          <option value="absent">Absent</option>
          <option value="excused">Excused</option>
        </select>
      </td>
      <td><input type="text" data-att-remarks placeholder="optional" style="width:100%;padding:7px 10px;border:1px solid var(--line-strong);border-radius:6px" /></td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" class="empty-state">No students enrolled.</td></tr>`;
}

async function saveAttendance() {
  const classId = $("#att-class-select").value;
  const dateVal = $("#att-date").value;
  if (!classId || !dateVal) return;
  const btn = $("#save-attendance-btn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const rows = $all("#attendance-tbody tr[data-student]");
    const payloads = rows.map((row) => ({
      class_id: classId, student_id: row.dataset.student, date: dateVal,
      status: row.querySelector("[data-att-status]").value,
      remarks: row.querySelector("[data-att-remarks]").value,
      recorded_by: PROFILE.uid, updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("attendance_records")
      .upsert(payloads, { onConflict: "class_id,student_id,date" });
    if (error) throw error;
    toast("Attendance saved.");
  } catch (e) {
    toast(e.message || "Could not save attendance.", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Save Attendance";
  }
}

// ---------- Export ----------
function exportGrades() {
  const classId = $("#export-class-select").value;
  if (!classId) return toast("Select a class first.", "error");
  const cls = STATE.classes.find((c) => c.id === classId);
  const roster = STATE.enrollmentsByClass[classId] || [];
  const grades = STATE.gradeRecordsByClass[classId] || [];
  const rows = roster.map((enr) => {
    const s = STATE.studentsById[enr.student_id] || {};
    const g = grades.find((gr) => gr.student_id === enr.student_id) || {};
    return [s.student_number, s.full_name, (g.activities||[]).join("/"), (g.quizzes||[]).join("/"), (g.projects||[]).join("/"), g.midterm_exam, g.final_exam, g.computed_final_grade, g.gpa_equivalent];
  });
  downloadCSV(`gradesheet_${classLabel(cls)}`, ["Student No.", "Name", "Activities", "Quizzes", "Projects", "Midterm", "Final Exam", "Final Grade", "GPA"], rows);
}

async function exportAttendance() {
  const classId = $("#export-class-select").value;
  if (!classId) return toast("Select a class first.", "error");
  const cls = STATE.classes.find((c) => c.id === classId);
  toast("Fetching attendance for export…");
  const { data: records } = await supabase.from("attendance_records").select("*").eq("class_id", classId);
  const rows = (records || []).map((r) => {
    const s = STATE.studentsById[r.student_id] || {};
    return [s.student_number, s.full_name, r.date, r.status, r.remarks || ""];
  });
  downloadCSV(`attendance_${classLabel(cls)}`, ["Student No.", "Name", "Date", "Status", "Remarks"], rows);
}
