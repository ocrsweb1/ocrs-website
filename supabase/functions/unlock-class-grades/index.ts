// POST /functions/v1/unlock-class-grades
// Admin-only, and requires a reason (recorded in the audit log) —
// matches the spec's "unlock grade records only when necessary."
import { corsHeaders, jsonResponse, requireAdmin, adminClient, writeAuditLog } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { uid, profile } = await requireAdmin(req);
    const { classId, reason } = await req.json();
    if (!classId || !reason || !String(reason).trim()) {
      return jsonResponse({ error: "classId and a reason are required." }, 400);
    }

    const admin = adminClient();
    const { error: updateErr } = await admin.from("classes").update({
      locked: false, unlocked_at: new Date().toISOString(), unlocked_by: uid, last_unlock_reason: reason,
    }).eq("id", classId);
    if (updateErr) return jsonResponse({ error: updateErr.message }, 400);

    await writeAuditLog(admin, {
      action: "UNLOCK_GRADE_SHEET", performedBy: uid, performedByName: profile.full_name,
      targetTable: "classes", targetId: classId, details: `Unlocked — reason: ${reason}`,
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: err?.message || "Unexpected error." }, 500);
  }
});
