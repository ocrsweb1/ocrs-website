import { supabase } from "./supabase-config.js";
import { guardPage, logout } from "./auth.js";
import { $, $all, toast, initials, fmtDateTime, standingFor, downloadCSV, debounce } from "./utils.js";

let PROFILE = null;
let STATE = {
  users: [], classes: [], subjects: {}, sections: {}, academicYears: [], semesters: [],
  enrollments: [], gradeRecords: [], auditLogs: [],
};
let programChart = null;

const STRUCT_SCHEMAS = {
  academic_years: {
    label: "Academic Year", fields: [{ key: "year", label: "Year (e.g. 2026-2027)", type: "text" }, { key: "is_active", label: "Active", type: "checkbox" }],
    columns: [["year", "Year"], ["is_active", "Active"]],
  },
  semesters: {
    label: "Semester",
    fields: [
      { key: "name", label: "Name (e.g. 1st Semester)", type: "text" },
      { key: "academic_year_id", label: "Academic Year", type: "select" },
      { key: "is_active", label: "Active", type: "checkbox" },
    ],
    columns: [["name", "Name"], ["academic_year_id", "Academic Year", "academic_years", "year"], ["is_active", "Active"]],
  },
  subjects: {
    label: "Subject",
    fields: [
      { key: "code", label: "Subject Code", type: "text" }, { key: "title", label: "Title", type: "text" },
      { key: "units", label: "Units", type: "number" }, { key: "program", label: "Program", type: "text" },
    ],
    columns: [["code", "Code"], ["title", "Title"], ["units", "Units"], ["program", "Program"]],
  },
  sections: {
    label: "Section",
    fields: [
      { key: "name", label: "Section Name (e.g. BSIT-3A)", type: "text" },
      { key: "program", label: "Program", type: "text" }, { key: "year_level", label: "Year Level", type: "text" },
    ],
    columns: [["name", "Name"], ["program", "Program"], ["year_level", "Year Level"]],
  },
};

guardPage("admin", async (profile) => {
  PROFILE = profile;
  renderShell();
  wireNav();
  wireUserModal();
  wireStructureView();
  wireReports();
  await loadEverything();
  renderOverview();
  renderProgress();
  renderUsers();
  renderAuditLog();
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
        overview: "Institutional Overview", progress: "Faculty Grade-Encoding Progress", users: "Accounts",
        structure: "Academic Structure", reports: "Reports", audit: "Audit Log",
      }[item.dataset.view];
      $("#new-user-btn").style.display = item.dataset.view === "users" ? "inline-flex" : "none";
      $("#new-struct-btn").style.display = item.dataset.view === "structure" ? "inline-flex" : "none";
      $("#sidebar").classList.remove("open");
    });
  });
}

async function loadEverything() {
  const [{ data: users }, { data: classes }, { data: subjects }, { data: sections }, { data: years }, { data: sems }] = await Promise.all([
    supabase.from("profiles").select("*"),
    supabase.from("classes").select("*"),
    supabase.from("subjects").select("*"),
    supabase.from("sections").select("*"),
    supabase.from("academic_years").select("*"),
    supabase.from("semesters").select("*"),
  ]);
  STATE.users = users || [];
  STATE.classes = classes || [];
  (subjects || []).forEach((s) => (STATE.subjects[s.id] = s));
  (sections || []).forEach((s) => (STATE.sections[s.id] = s));
  STATE.academicYears = years || [];
  STATE.semesters = sems || [];

  const [{ data: enrollments }, { data: grades }] = await Promise.all([
    supabase.from("enrollments").select("*"),
    supabase.from("grade_records").select("*"),
  ]);
  STATE.enrollments = enrollments || [];
  STATE.gradeRecords = grades || [];

  const { data: audit } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
  STATE.auditLogs = audit || [];

  populateSemesterFilter();
}

function usersByRole(role) { return STATE.users.filter((u) => u.role === role); }

function renderOverview() {
  const students = usersByRole("student");
  const faculty = usersByRole("faculty");
  const activeClasses = STATE.classes.filter((c) => c.status !== "inactive");

  const totalGraded = STATE.gradeRecords.filter((g) => g.computed_final_grade !== null && g.computed_final_grade !== undefined).length;
  const totalExpected = STATE.enrollments.length;
  const completionRate = totalExpected ? Math.round((totalGraded / totalExpected) * 100) : 0;

  const gpas = STATE.gradeRecords.map((g) => g.gpa_equivalent).filter((g) => g !== null && g !== undefined);
  const avgGPA = gpas.length ? Math.round((gpas.reduce((a, b) => a + b, 0) / gpas.length) * 100) / 100 : null;

  const incompleteCount = totalExpected - totalGraded;

  const perStudentGPA = {};
  students.forEach((s) => {
    const own = STATE.gradeRecords.filter((g) => g.student_id === s.id && g.gpa_equivalent != null).map((g) => g.gpa_equivalent);
    perStudentGPA[s.id] = own.length ? own.reduce((a, b) => a + b, 0) / own.length : null;
  });
  const needingSupport = students.filter((s) => perStudentGPA[s.id] !== null && perStudentGPA[s.id] > 3.0);

  $("#overview-stats").innerHTML = `
    <div class="card stat-card"><div class="label">Total Students</div><div class="value">${students.length}</div></div>
    <div class="card stat-card"><div class="label">Total Faculty</div><div class="value">${faculty.length}</div></div>
    <div class="card stat-card"><div class="label">Active Classes</div><div class="value">${activeClasses.length}</div></div>
    <div class="card stat-card"><div class="label">Grade Encoding Rate</div><div class="value">${completionRate}%</div></div>
    <div class="card stat-card"><div class="label">Average GPA</div><div class="value">${avgGPA ?? "—"}</div></div>
    <div class="card stat-card"><div class="label">Incomplete Records</div><div class="value" style="color:${incompleteCount ? "var(--amber-600)" : "var(--green-950)"}">${incompleteCount}</div></div>
    <div class="card stat-card"><div class="label">Needing Academic Support</div><div class="value" style="color:${needingSupport.length ? "var(--red-600)" : "var(--green-950)"}">${needingSupport.length}</div></div>
    <div class="card stat-card"><div class="label">Locked Classes</div><div class="value">${STATE.classes.filter((c) => c.locked).length}</div></div>`;

  $("#support-list").innerHTML = needingSupport.length ? needingSupport.slice(0, 8).map((s) => `
    <div class="flex" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">
      <div><b style="font-size:13px">${s.full_name}</b><br/><span class="subtle">${s.program || "—"} · ${s.section || "—"}</span></div>
      <span class="badge badge-amber">GPA ${Math.round(perStudentGPA[s.id]*100)/100}</span>
    </div>`).join("") : `<div class="empty-state">No students currently flagged.</div>`;

  const byProgram = {};
  students.forEach((s) => {
    const p = s.program || "Unassigned";
    if (perStudentGPA[s.id] === null) return;
    byProgram[p] = byProgram[p] || [];
    byProgram[p].push(perStudentGPA[s.id]);
  });
  const labels = Object.keys(byProgram);
  const data = labels.map((p) => Math.round((byProgram[p].reduce((a, b) => a + b, 0) / byProgram[p].length) * 100) / 100);
  const ctx = document.getElementById("program-chart");
  if (programChart) programChart.destroy();
  programChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Avg GPA", data, backgroundColor: "#146C43", borderRadius: 6, maxBarThickness: 40 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { reverse: true, min: 1, max: 5, grid: { color: "#EAF0E9" } }, x: { grid: { display: false } } } },
  });
}

// ---------- Faculty Progress ----------
function populateSemesterFilter() {
  $("#progress-filter-sem").innerHTML = `<option value="">All Semesters</option>` +
    STATE.semesters.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  $("#progress-filter-sem").addEventListener("change", renderProgress);
}

function renderProgress() {
  const semId = $("#progress-filter-sem").value;
  const classes = STATE.classes.filter((c) => !semId || c.semester_id === semId);

  $("#progress-tbody").innerHTML = classes.length ? classes.map((cls) => {
    const fac = STATE.users.find((u) => u.id === cls.faculty_id) || {};
    const subj = STATE.subjects[cls.subject_id] || {};
    const sect = STATE.sections[cls.section_id] || {};
    const roster = STATE.enrollments.filter((e) => e.class_id === cls.id);
    const graded = STATE.gradeRecords.filter((g) => g.class_id === cls.id && g.computed_final_grade != null);
    const pct = roster.length ? Math.round((graded.length / roster.length) * 100) : 0;
    return `<tr>
      <td>${fac.full_name || "—"}</td>
      <td>${subj.code || "—"}</td>
      <td>${sect.name || "—"}</td>
      <td class="num">${roster.length}</td>
      <td class="num">${graded.length}</td>
      <td style="min-width:140px"><div class="progress"><div style="width:${pct}%"></div></div></td>
      <td>
        <span class="badge ${cls.locked ? "badge-amber" : "badge-green"}"><span class="dot"></span>${cls.locked ? "Locked" : "Open"}</span>
        ${cls.locked ? `<button class="btn btn-outline btn-sm" data-unlock="${cls.id}" style="margin-left:6px">Unlock</button>` : ""}
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="7" class="empty-state">No classes found.</td></tr>`;

  $all("[data-unlock]").forEach((btn) => btn.addEventListener("click", () => {
    $("#unlock-modal").dataset.classId = btn.dataset.unlock;
    $("#unlock-modal").classList.add("open");
  }));
}

$("#unlock-confirm-btn")?.addEventListener("click", async () => {
  const modal = $("#unlock-modal");
  const classId = modal.dataset.classId;
  const reason = $("#unlock-reason").value.trim();
  if (!reason) return toast("Please provide a reason — it will be recorded in the audit log.", "error");
  const { error } = await supabase.functions.invoke("unlock-class-grades", { body: { classId, reason } });
  if (error) return toast(error.message || "Could not unlock grade sheet.", "error");
  const cls = STATE.classes.find((c) => c.id === classId);
  if (cls) cls.locked = false;
  modal.classList.remove("open");
  $("#unlock-reason").value = "";
  toast("Grade sheet unlocked. Faculty can resume editing.");
  renderProgress();
});

// ---------- Users ----------
function renderUsers() {
  const role = $("#user-filter-role").value;
  const q = ($("#user-search").value || "").toLowerCase();
  const rows = STATE.users.filter((u) => (!role || u.role === role) &&
    (!q || (u.full_name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q)));

  $("#users-tbody").innerHTML = rows.length ? rows.map((u) => `
    <tr>
      <td><b>${u.full_name || "—"}</b></td>
      <td>${u.email || "—"}</td>
      <td><span class="badge badge-green"><span class="dot"></span>${u.role}</span></td>
      <td class="mono">${u.student_number || u.employee_number || "—"}</td>
      <td>${u.program || "—"}${u.section ? " · " + u.section : ""}</td>
      <td><span class="badge ${u.status === "active" ? "badge-green" : "badge-red"}"><span class="dot"></span>${u.status || "active"}</span></td>
      <td class="text-right">
        <button class="btn btn-outline btn-sm" data-toggle-status="${u.id}">${u.status === "active" ? "Deactivate" : "Activate"}</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty-state">No accounts match.</td></tr>`;

  $all("[data-toggle-status]").forEach((btn) => btn.addEventListener("click", async () => {
    const uid = btn.dataset.toggleStatus;
    const u = STATE.users.find((x) => x.id === uid);
    const newStatus = u.status === "active" ? "inactive" : "active";
    const { error } = await supabase.functions.invoke("set-user-status", { body: { uid, status: newStatus } });
    if (error) return toast(error.message || "Could not update account status.", "error");
    u.status = newStatus;
    renderUsers();
    toast(`Account ${newStatus === "active" ? "activated" : "deactivated"}.`);
  }));
}

$("#user-filter-role").addEventListener("change", renderUsers);
$("#user-search").addEventListener("input", debounce(renderUsers, 200));

function wireUserModal() {
  $("#new-user-btn").addEventListener("click", () => openUserModal());
  $all("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest(".modal-overlay").classList.remove("open")));
  $("#u-role").addEventListener("change", syncUserModalFields);

  $("#u-save-btn").addEventListener("click", async () => {
    const payload = {
      role: $("#u-role").value,
      fullName: $("#u-fullName").value.trim(),
      email: $("#u-email").value.trim(),
      password: $("#u-password").value,
      idNumber: $("#u-idno").value.trim(),
      program: $("#u-program").value.trim(),
      yearLevel: $("#u-yearLevel").value.trim(),
      section: $("#u-section").value.trim(),
    };
    const err = $("#user-modal-error");
    err.classList.remove("show");
    if (!payload.fullName || !payload.email || !payload.password || payload.password.length < 8) {
      err.textContent = "Full name, email, and an 8+ character password are required.";
      err.classList.add("show");
      return;
    }
    const { data, error } = await supabase.functions.invoke("create-user-account", { body: payload });
    if (error) {
      err.textContent = error.message || "Could not create account.";
      err.classList.add("show");
      return;
    }
    STATE.users.push({
      id: data.uid, full_name: payload.fullName, email: payload.email, role: payload.role, status: "active",
      program: payload.program, year_level: payload.yearLevel, section: payload.section,
      student_number: payload.role === "student" ? payload.idNumber : null,
      employee_number: payload.role === "faculty" ? payload.idNumber : null,
    });
    $("#user-modal").classList.remove("open");
    renderUsers();
    toast("Account created. Share the temporary password securely with the user.");
  });
}

function openUserModal() {
  $("#user-modal-title").textContent = "New Account";
  $("#u-save-btn").textContent = "Create Account";
  ["u-fullName", "u-email", "u-password", "u-idno", "u-program", "u-yearLevel", "u-section"].forEach((id) => ($(`#${id}`).value = ""));
  $("#u-role").value = "student";
  syncUserModalFields();
  $("#user-modal").classList.add("open");
}

function syncUserModalFields() {
  const role = $("#u-role").value;
  $("#u-idno-label").textContent = role === "student" ? "Student Number" : role === "faculty" ? "Employee Number" : "ID Number";
  $("#u-student-fields").style.display = role === "student" ? "grid" : "none";
  $("#u-section-field").style.display = role === "student" ? "block" : "none";
}

// ---------- Academic Structure ----------
function wireStructureView() {
  $("#structure-type").addEventListener("change", renderStructureTable);
  $("#new-struct-btn").addEventListener("click", () => openStructModal());
  renderStructureTable();
}

function currentSchema() { return STRUCT_SCHEMAS[$("#structure-type").value]; }
function collectionFor(type) {
  return { academic_years: STATE.academicYears, semesters: STATE.semesters, subjects: Object.values(STATE.subjects), sections: Object.values(STATE.sections) }[type];
}

function renderStructureTable() {
  const type = $("#structure-type").value;
  const schema = currentSchema();
  const items = collectionFor(type);

  $("#structure-thead").innerHTML = `<tr>${schema.columns.map((c) => `<th>${c[1]}</th>`).join("")}<th></th></tr>`;
  $("#structure-tbody").innerHTML = items.length ? items.map((item) => `
    <tr>
      ${schema.columns.map((c) => {
        const [key, , refCollection, refLabel] = c;
        let val = item[key];
        if (refCollection) {
          const ref = STATE.academicYears.find((r) => r.id === val);
          val = ref ? ref[refLabel] : "—";
        }
        if (typeof val === "boolean") val = val ? "Yes" : "No";
        return `<td>${val ?? "—"}</td>`;
      }).join("")}
      <td class="text-right"><button class="btn btn-outline btn-sm" data-edit-struct="${item.id}">Edit</button></td>
    </tr>`).join("") : `<tr><td colspan="${schema.columns.length + 1}" class="empty-state">No records yet.</td></tr>`;

  $all("[data-edit-struct]").forEach((btn) => btn.addEventListener("click", () => openStructModal(btn.dataset.editStruct)));
}

function openStructModal(itemId = null) {
  const type = $("#structure-type").value;
  const schema = currentSchema();
  const item = itemId ? collectionFor(type).find((i) => i.id === itemId) : {};
  $("#struct-modal-title").textContent = `${itemId ? "Edit" : "Add"} ${schema.label}`;
  $("#struct-modal-body").innerHTML = schema.fields.map((f) => {
    if (f.type === "select") {
      const options = STATE.academicYears.map((y) => `<option value="${y.id}" ${item[f.key] === y.id ? "selected" : ""}>${y.year}</option>`).join("");
      return `<div class="field"><label>${f.label}</label><select data-field="${f.key}">${options}</select></div>`;
    }
    if (f.type === "checkbox") {
      return `<div class="field"><label><input type="checkbox" data-field="${f.key}" ${item[f.key] ? "checked" : ""} style="width:auto;margin-right:8px" />${f.label}</label></div>`;
    }
    return `<div class="field"><label>${f.label}</label><input type="${f.type}" data-field="${f.key}" value="${item[f.key] ?? ""}" /></div>`;
  }).join("");

  $("#struct-save-btn").onclick = async () => {
    const payload = {};
    schema.fields.forEach((f) => {
      const el = $(`#struct-modal-body [data-field="${f.key}"]`);
      payload[f.key] = f.type === "checkbox" ? el.checked : f.type === "number" ? Number(el.value) : el.value.trim();
    });
    if (itemId) {
      const { error } = await supabase.from(type).update(payload).eq("id", itemId);
      if (error) return toast(error.message || "Could not save record.", "error");
      Object.assign(item, payload);
    } else {
      const { data, error } = await supabase.from(type).insert(payload).select().single();
      if (error) return toast(error.message || "Could not save record.", "error");
      collectionFor(type).push(data);
      if (type === "subjects") STATE.subjects[data.id] = data;
      if (type === "sections") STATE.sections[data.id] = data;
    }
    $("#struct-modal").classList.remove("open");
    renderStructureTable();
    toast("Saved.");
  };
  $("#struct-modal").classList.add("open");
}

// ---------- Reports ----------
function wireReports() {
  $all("[data-report]").forEach((btn) => btn.addEventListener("click", () => generateReport(btn.dataset.report)));
}

async function generateReport(type) {
  const { error } = await supabase.functions.invoke("generate-report", { body: { type } });
  if (error) console.warn("generate-report function not reachable, continuing with client-side export:", error.message);

  if (type === "institutional") {
    const rows = STATE.classes.map((cls) => {
      const subj = STATE.subjects[cls.subject_id] || {};
      const sect = STATE.sections[cls.section_id] || {};
      const roster = STATE.enrollments.filter((e) => e.class_id === cls.id).length;
      const graded = STATE.gradeRecords.filter((g) => g.class_id === cls.id && g.computed_final_grade != null).length;
      return [subj.code, sect.name, roster, graded, roster ? Math.round((graded / roster) * 100) + "%" : "0%", cls.locked ? "Locked" : "Open"];
    });
    downloadCSV("institutional_overview", ["Subject", "Section", "Enrolled", "Encoded", "Completion", "Status"], rows);
  }
  if (type === "standing") {
    const rows = usersByRole("student").map((s) => {
      const own = STATE.gradeRecords.filter((g) => g.student_id === s.id && g.gpa_equivalent != null).map((g) => g.gpa_equivalent);
      const avg = own.length ? Math.round((own.reduce((a, b) => a + b, 0) / own.length) * 100) / 100 : null;
      return [s.student_number, s.full_name, s.program, avg ?? "—", standingFor(avg).label];
    });
    downloadCSV("student_academic_standing", ["Student No.", "Name", "Program", "Avg GPA", "Standing"], rows);
  }
  if (type === "faculty") {
    const rows = usersByRole("faculty").map((f) => {
      const classes = STATE.classes.filter((c) => c.faculty_id === f.id);
      const roster = STATE.enrollments.filter((e) => classes.some((c) => c.id === e.class_id)).length;
      const graded = STATE.gradeRecords.filter((g) => classes.some((c) => c.id === g.class_id) && g.computed_final_grade != null).length;
      return [f.full_name, classes.length, roster, graded, classes.filter((c) => c.locked).length];
    });
    downloadCSV("faculty_grade_summary", ["Faculty", "Classes", "Total Enrolled", "Total Encoded", "Locked Classes"], rows);
  }
  toast("Report generated and downloaded.");
}

// ---------- Audit Log ----------
function renderAuditLog() {
  $("#audit-tbody").innerHTML = STATE.auditLogs.length ? STATE.auditLogs.map((a) => `
    <tr>
      <td class="mono">${fmtDateTime(a.created_at)}</td>
      <td><span class="badge badge-gray"><span class="dot"></span>${a.action}</span></td>
      <td>${a.performed_by_name || a.performed_by || "—"}</td>
      <td>${a.target_table || "—"}${a.target_id ? " / " + a.target_id : ""}</td>
      <td>${a.details || "—"}</td>
    </tr>`).join("") : `<tr><td colspan="5" class="empty-state">No audit entries yet.</td></tr>`;
}
