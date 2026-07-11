import { supabase } from "./supabase-config.js";
import { guardPage, logout } from "./auth.js";
import { $, $all, toast, initials, fmtDate, remarkFor, standingFor, renderSealGauge } from "./utils.js";

let PROFILE = null;
let STATE = {
  academicYears: [], semesters: [], subjects: {}, classes: {}, sections: {},
  enrollments: [], gradeRecords: [], attendanceRecords: [],
};
let trendChart = null;

guardPage("student", async (profile) => {
  PROFILE = profile;
  renderShell();
  wireNav();
  wireFilters();
  await loadEverything();
  renderOverview();
  renderGradesTable();
  renderAttendance();
  renderProfile();
});

$("#signout-btn").addEventListener("click", logout);
$("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

function renderShell() {
  $("#user-avatar").textContent = initials(PROFILE.full_name || PROFILE.email);
  $("#user-name").textContent = PROFILE.full_name || PROFILE.email;
  $("#user-meta").textContent = `${PROFILE.program || "—"} · ${PROFILE.year_level || "—"}`;
}

function wireNav() {
  $all(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      $all(".nav-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      $all(".view").forEach((v) => (v.style.display = "none"));
      $(`#view-${item.dataset.view}`).style.display = "block";
      $("#page-title").textContent = {
        overview: "Academic Overview", grades: "My Grades", attendance: "Attendance", profile: "My Profile",
      }[item.dataset.view];
      $("#sidebar").classList.remove("open");
    });
  });
}

function wireFilters() {
  $("#filter-year").addEventListener("change", renderGradesTable);
  $("#filter-semester").addEventListener("change", renderGradesTable);
  $("#filter-subject").addEventListener("change", renderGradesTable);
  $("#att-filter-subject").addEventListener("change", renderAttendance);
}

async function loadEverything() {
  const [{ data: years }, { data: sems }] = await Promise.all([
    supabase.from("academic_years").select("*").order("year", { ascending: false }),
    supabase.from("semesters").select("*"),
  ]);
  STATE.academicYears = years || [];
  STATE.semesters = sems || [];

  $("#filter-year").innerHTML = `<option value="">All Academic Years</option>` +
    STATE.academicYears.map((y) => `<option value="${y.id}">${y.year}</option>`).join("");
  $("#filter-semester").innerHTML = `<option value="">All Semesters</option>` +
    STATE.semesters.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");

  // Enrollments -> classes -> subjects/sections
  const { data: enrollments } = await supabase.from("enrollments").select("*").eq("student_id", PROFILE.uid);
  STATE.enrollments = enrollments || [];

  const classIds = [...new Set(STATE.enrollments.map((e) => e.class_id))];
  if (classIds.length) {
    const { data: classes } = await supabase.from("classes").select("*").in("id", classIds);
    (classes || []).forEach((c) => (STATE.classes[c.id] = c));
  }

  const subjectIds = [...new Set(Object.values(STATE.classes).map((c) => c.subject_id))];
  const sectionIds = [...new Set(Object.values(STATE.classes).map((c) => c.section_id))];
  if (subjectIds.length) {
    const { data: subjects } = await supabase.from("subjects").select("*").in("id", subjectIds);
    (subjects || []).forEach((s) => (STATE.subjects[s.id] = s));
  }
  if (sectionIds.length) {
    const { data: sections } = await supabase.from("sections").select("*").in("id", sectionIds);
    (sections || []).forEach((s) => (STATE.sections[s.id] = s));
  }

  // Grade records + attendance (RLS restricts to this student's own rows regardless)
  const [{ data: grades }, { data: attendance }] = await Promise.all([
    supabase.from("grade_records").select("*").eq("student_id", PROFILE.uid),
    supabase.from("attendance_records").select("*").eq("student_id", PROFILE.uid),
  ]);
  STATE.gradeRecords = grades || [];
  STATE.attendanceRecords = attendance || [];

  const subjOptionsHTML = Object.values(STATE.subjects)
    .map((s) => `<option value="${s.id}">${s.code} — ${s.title}</option>`).join("");
  $("#filter-subject").innerHTML = `<option value="">All Subjects</option>` + subjOptionsHTML;
  $("#att-filter-subject").innerHTML = `<option value="">All Subjects</option>` + subjOptionsHTML;
}

function gradeRecordFor(classId) {
  return STATE.gradeRecords.find((g) => g.class_id === classId) || null;
}

function renderOverview() {
  const activeClassIds = Object.keys(STATE.classes);
  const gpas = activeClassIds
    .map((cid) => gradeRecordFor(cid)?.gpa_equivalent)
    .filter((g) => g !== null && g !== undefined);
  const avgGPA = gpas.length ? Math.round((gpas.reduce((a, b) => a + b, 0) / gpas.length) * 100) / 100 : null;

  const totalUnits = activeClassIds.reduce((sum, cid) => {
    const subj = STATE.subjects[STATE.classes[cid].subject_id];
    return sum + (subj?.units || 0);
  }, 0);

  const atRisk = activeClassIds.filter((cid) => {
    const g = gradeRecordFor(cid);
    return g && g.computed_final_grade !== null && g.computed_final_grade !== undefined && g.computed_final_grade < 75;
  });
  const incomplete = activeClassIds.filter((cid) => {
    const g = gradeRecordFor(cid);
    return !g || g.computed_final_grade === null || g.computed_final_grade === undefined;
  });

  $("#overview-stats").innerHTML = `
    <div class="card stat-card">
      <div class="label">Current GPA</div>
      <div class="value">${avgGPA ?? "—"}</div>
      <div class="delta flat">Scale: 1.00 highest – 5.00 lowest</div>
    </div>
    <div class="card stat-card">
      <div class="label">Units Enrolled</div>
      <div class="value">${totalUnits}</div>
      <div class="delta flat">${activeClassIds.length} subject${activeClassIds.length === 1 ? "" : "s"}</div>
    </div>
    <div class="card stat-card">
      <div class="label">Subjects At Risk</div>
      <div class="value" style="color:${atRisk.length ? "var(--red-600)" : "var(--green-950)"}">${atRisk.length}</div>
      <div class="delta ${atRisk.length ? "down" : "flat"}">Final grade below 75</div>
    </div>
    <div class="card stat-card">
      <div class="label">Incomplete Records</div>
      <div class="value" style="color:${incomplete.length ? "var(--amber-600)" : "var(--green-950)"}">${incomplete.length}</div>
      <div class="delta flat">Awaiting faculty encoding</div>
    </div>`;

  const warnings = [];
  if (atRisk.length) warnings.push(`You have <b>${atRisk.length}</b> subject${atRisk.length > 1 ? "s" : ""} currently below passing grade.`);
  if (incomplete.length) warnings.push(`<b>${incomplete.length}</b> subject${incomplete.length > 1 ? "s" : ""} still ${incomplete.length > 1 ? "have" : "has"} incomplete grades.`);
  $("#warnings-slot").innerHTML = warnings.length
    ? `<div class="locked-banner">⚠ ${warnings.join(" &nbsp;·&nbsp; ")}</div>` : "";

  const standing = standingFor(avgGPA);
  $("#standing-block").innerHTML = `
    <div id="seal-gauge-slot"></div>
    <span class="badge badge-${standing.tone}" style="margin-top:10px"><span class="dot"></span>${standing.label}</span>
    <p style="text-align:center;font-size:12.5px;margin-top:8px">Based on average GPA across all enrolled subjects this semester.</p>`;
  renderSealGauge($("#seal-gauge-slot"), { value: avgGPA ?? 0, max: 5, label: "AVG GPA", suffix: "" });

  $("#overview-subject-count").textContent = `${activeClassIds.length} subject${activeClassIds.length === 1 ? "" : "s"}`;
  $("#subject-cards").innerHTML = activeClassIds.length
    ? activeClassIds.map((cid) => subjectCardHTML(cid)).join("")
    : `<div class="empty-state" style="grid-column:1/-1"><div class="icon">📭</div>No subjects enrolled yet.</div>`;

  renderTrendChart(activeClassIds);
}

function subjectCardHTML(classId) {
  const cls = STATE.classes[classId];
  const subj = STATE.subjects[cls.subject_id] || {};
  const g = gradeRecordFor(classId);
  const fg = g?.computed_final_grade;
  const remark = remarkFor(fg);
  const pct = fg ?? 0;
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 style="margin-bottom:2px">${subj.code || "—"}</h3>
          <span class="subtle">${subj.title || ""}</span>
        </div>
        <span class="badge badge-${remark.tone}"><span class="dot"></span>${remark.label}</span>
      </div>
      <div style="margin:12px 0 6px" class="flex" style="justify-content:space-between">
        <span class="subtle">Final Grade</span>
        <span class="mono" style="font-weight:700">${fg ?? "—"}</span>
      </div>
      <div class="progress"><div style="width:${Math.min(pct, 100)}%;background:${fg && fg < 75 ? "var(--red-600)" : "var(--gold-500)"}"></div></div>
      <div class="flex" style="justify-content:space-between;margin-top:10px">
        <span class="subtle">GPA Equivalent</span>
        <span class="mono">${g?.gpa_equivalent ?? "—"}</span>
      </div>
    </div>`;
}

function renderTrendChart(classIds) {
  const ctx = document.getElementById("trend-chart");
  const labels = classIds.map((cid) => STATE.subjects[STATE.classes[cid].subject_id]?.code || "—");
  const data = classIds.map((cid) => gradeRecordFor(cid)?.computed_final_grade ?? null);
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Final Grade",
        data,
        backgroundColor: data.map((d) => (d !== null && d < 75 ? "#B23B3B" : "#C9A227")),
        borderRadius: 6,
        maxBarThickness: 34,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 100, grid: { color: "#EAF0E9" } }, x: { grid: { display: false } } },
    },
  });
}

function renderGradesTable() {
  const yearId = $("#filter-year").value;
  const semId = $("#filter-semester").value;
  const subjId = $("#filter-subject").value;

  const rows = Object.values(STATE.classes).filter((cls) => {
    if (yearId && cls.academic_year_id !== yearId) return false;
    if (semId && cls.semester_id !== semId) return false;
    if (subjId && cls.subject_id !== subjId) return false;
    return true;
  });

  if (!rows.length) {
    $("#grades-tbody").innerHTML = `<tr><td colspan="10" class="empty-state">No grade records match these filters.</td></tr>`;
    return;
  }

  $("#grades-tbody").innerHTML = rows.map((cls) => {
    const subj = STATE.subjects[cls.subject_id] || {};
    const sect = STATE.sections[cls.section_id] || {};
    const g = gradeRecordFor(cls.id) || {};
    const remark = remarkFor(g.computed_final_grade);
    const avg = (arr) => (arr && arr.length ? Math.round((arr.reduce((a, b) => a + Number(b), 0) / arr.length) * 100) / 100 : "—");
    return `<tr>
      <td><b>${subj.code || "—"}</b><br/><span class="subtle">${subj.title || ""}</span></td>
      <td>${sect.name || "—"}</td>
      <td class="num">${avg(g.activities)}</td>
      <td class="num">${avg(g.quizzes)}</td>
      <td class="num">${avg(g.projects)}</td>
      <td class="num">${g.midterm_exam ?? "—"}</td>
      <td class="num">${g.final_exam ?? "—"}</td>
      <td class="num" style="font-weight:700">${g.computed_final_grade ?? "—"}</td>
      <td class="num">${g.gpa_equivalent ?? "—"}</td>
      <td><span class="badge badge-${remark.tone}"><span class="dot"></span>${remark.label}</span></td>
    </tr>`;
  }).join("");
}

function renderAttendance() {
  const subjId = $("#att-filter-subject").value;
  let records = STATE.attendanceRecords.slice();
  if (subjId) {
    const classIdsForSubject = Object.values(STATE.classes).filter((c) => c.subject_id === subjId).map((c) => c.id);
    records = records.filter((r) => classIdsForSubject.includes(r.class_id));
  }
  records.sort((a, b) => new Date(b.date) - new Date(a.date));

  const total = records.length;
  const present = records.filter((r) => r.status === "present").length;
  const absent = records.filter((r) => r.status === "absent").length;
  const late = records.filter((r) => r.status === "late").length;
  const rate = total ? Math.round((present / total) * 1000) / 10 : null;

  $("#attendance-stats").innerHTML = `
    <div class="card stat-card"><div class="label">Attendance Rate</div><div class="value">${rate ?? "—"}${rate !== null ? "%" : ""}</div></div>
    <div class="card stat-card"><div class="label">Present</div><div class="value" style="color:var(--green-700)">${present}</div></div>
    <div class="card stat-card"><div class="label">Late</div><div class="value" style="color:var(--amber-600)">${late}</div></div>
    <div class="card stat-card"><div class="label">Absent</div><div class="value" style="color:var(--red-600)">${absent}</div></div>`;

  $("#attendance-tbody").innerHTML = records.length ? records.map((r) => {
    const subj = STATE.subjects[STATE.classes[r.class_id]?.subject_id] || {};
    const tone = { present: "green", late: "amber", absent: "red", excused: "gray" }[r.status] || "gray";
    return `<tr>
      <td>${fmtDate(r.date)}</td>
      <td>${subj.code || "—"}</td>
      <td><span class="badge badge-${tone}"><span class="dot"></span>${r.status}</span></td>
      <td>${r.remarks || "—"}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="4" class="empty-state">No attendance records yet.</td></tr>`;
}

function renderProfile() {
  const rows = [
    ["Full Name", PROFILE.full_name], ["Student Number", PROFILE.student_number],
    ["Email", PROFILE.email], ["Program", PROFILE.program],
    ["Year Level", PROFILE.year_level], ["Section", PROFILE.section],
    ["Status", PROFILE.status],
  ];
  $("#profile-block").innerHTML = rows.map(([label, val]) => `
    <div>
      <div style="font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-500);font-weight:600;margin-bottom:4px">${label}</div>
      <div style="font-size:14px">${val || "—"}</div>
    </div>`).join("");
}
