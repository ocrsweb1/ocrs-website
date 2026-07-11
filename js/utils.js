// ============================================================
// Shared utilities: toasts, formatting, GPA/remarks mapping, CSV export.
// ============================================================

export function toast(message, type = "info") {
  const root = document.getElementById("toast-root");
  if (!root) return alert(message);
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function $(sel, scope = document) {
  return scope.querySelector(sel);
}
export function $all(sel, scope = document) {
  return Array.from(scope.querySelectorAll(sel));
}

export function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Weighted component config: { activities, quizzes, projects, midtermExam, finalExam } summing to 100
export const DEFAULT_WEIGHTS = { activities: 20, quizzes: 20, projects: 20, midtermExam: 20, finalExam: 20 };

export function average(arr = []) {
  const nums = arr.map((n) => Number(n)).filter((n) => !Number.isNaN(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Computes a weighted final grade (0-100 scale) from raw component scores.
// This mirrors the logic authoritatively re-computed server-side in Cloud Functions;
// the client copy is used only for live preview while faculty are encoding.
export function computeWeightedFinal(record, weights = DEFAULT_WEIGHTS) {
  const parts = [
    ["activities", average(record.activities)],
    ["quizzes", average(record.quizzes)],
    ["projects", average(record.projects)],
    ["midtermExam", record.midtermExam],
    ["finalExam", record.finalExam],
  ];
  let weightedSum = 0;
  let weightUsed = 0;
  for (const [key, score] of parts) {
    if (score === null || score === undefined || score === "") continue;
    const w = weights[key] ?? 0;
    weightedSum += Number(score) * (w / 100);
    weightUsed += w;
  }
  if (weightUsed === 0) return { finalGrade: null, complete: false };
  const finalGrade = weightUsed > 0 ? (weightedSum / weightUsed) * 100 : null;
  const complete = weightUsed >= 100;
  return { finalGrade: finalGrade === null ? null : Math.round(finalGrade * 100) / 100, complete };
}

// SLSU-style 1.0 (highest) – 5.0 (failing) equivalent from a 100-point final grade.
export function gradeToGPA(finalGrade) {
  if (finalGrade === null || finalGrade === undefined) return null;
  const table = [
    [97, 1.0], [94, 1.25], [91, 1.5], [88, 1.75], [85, 2.0],
    [82, 2.25], [79, 2.5], [76, 2.75], [75, 3.0],
  ];
  for (const [min, gpa] of table) {
    if (finalGrade >= min) return gpa;
  }
  return 5.0; // below 75 = failed
}

export function remarkFor(finalGrade) {
  if (finalGrade === null || finalGrade === undefined) return { label: "Incomplete", tone: "gray" };
  if (finalGrade >= 75) return { label: "Passed", tone: "green" };
  return { label: "Failed", tone: "red" };
}

export function standingFor(gpaAverage) {
  if (gpaAverage === null || gpaAverage === undefined) return { label: "No Data", tone: "gray" };
  if (gpaAverage <= 1.45) return { label: "President's Lister", tone: "gold" };
  if (gpaAverage <= 1.75) return { label: "Dean's Lister", tone: "gold" };
  if (gpaAverage <= 3.0) return { label: "Good Standing", tone: "green" };
  return { label: "Needs Support", tone: "amber" };
}

export function toCSV(headers, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) lines.push(row.map(esc).join(","));
  return lines.join("\n");
}

export function downloadCSV(filename, headers, rows) {
  const csv = toCSV(headers, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Renders the signature "seal gauge" concentric ring meter into a container.
export function renderSealGauge(container, { value, max = 100, label = "", suffix = "" }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const r = 46;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  container.innerHTML = `
    <div class="seal-gauge">
      <svg width="112" height="112" viewBox="0 0 112 112">
        <circle class="track" cx="56" cy="56" r="${r}" fill="none" stroke-width="8"></circle>
        <circle class="ring-inner" cx="56" cy="56" r="${r - 12}" fill="none"></circle>
        <circle class="fill" cx="56" cy="56" r="${r}" fill="none" stroke-width="8"
          stroke-dasharray="${c}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <div class="center">
        <b>${value === null || value === undefined ? "—" : value}${suffix}</b>
        <span>${label}</span>
      </div>
    </div>`;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function requireRoleOrRedirect(profile, expectedRole) {
  if (!profile || profile.role !== expectedRole) {
    location.href = "index.html";
    return false;
  }
  if (profile.status && profile.status !== "active") {
    alert("Your account is not active. Please contact the registrar/administrator.");
    location.href = "index.html";
    return false;
  }
  return true;
}
