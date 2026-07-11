// POST /functions/v1/generate-report
// Admin or faculty. Writes a `reports` row and an audit log entry so
// report generation is traceable. The actual CSV is assembled client-side
// from data the caller already has read access to (see js/admin.js /
// js/faculty.js) — this call exists purely for the auditable record.
import { corsHeaders, jsonResponse, requireCaller, adminClient, writeAuditLog } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { uid, profile } = await requireCaller(req);
    if (!["admin", "faculty"].includes(profile.role)) {
      return jsonResponse({ error: "Not authorized to generate reports." }, 403);
    }
    const { type } = await req.json();
    if (!type) return jsonResponse({ error: "Report type is required." }, 400);

    const admin = adminClient();
    const { data: report, error } = await admin.from("reports").insert({
      type, generated_by: uid, generated_by_name: profile.full_name,
    }).select().single();
    if (error) return jsonResponse({ error: error.message }, 400);

    await writeAuditLog(admin, {
      action: "GENERATE_REPORT", performedBy: uid, performedByName: profile.full_name,
      targetTable: "reports", targetId: report.id, details: `Generated report: ${type}`,
    });

    return jsonResponse({ reportId: report.id });
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: err?.message || "Unexpected error." }, 500);
  }
});
