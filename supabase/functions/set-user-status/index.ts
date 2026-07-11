// POST /functions/v1/set-user-status
// Admin-only. Flips profiles.status and disables/enables the underlying
// Supabase Auth user so a deactivated person truly cannot sign in.
import { corsHeaders, jsonResponse, requireAdmin, adminClient, writeAuditLog } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { uid: adminUid, profile: adminProfile } = await requireAdmin(req);
    const { uid, status } = await req.json();
    if (!uid || !["active", "inactive"].includes(status)) {
      return jsonResponse({ error: "uid and a valid status are required." }, 400);
    }

    const admin = adminClient();
    const { error: updateErr } = await admin.from("profiles").update({
      status, status_updated_at: new Date().toISOString(), status_updated_by: adminUid,
    }).eq("id", uid);
    if (updateErr) return jsonResponse({ error: updateErr.message }, 400);

    await admin.auth.admin.updateUserById(uid, { ban_duration: status === "inactive" ? "876000h" : "none" });

    await writeAuditLog(admin, {
      action: status === "active" ? "ACTIVATE_ACCOUNT" : "DEACTIVATE_ACCOUNT",
      performedBy: adminUid, performedByName: adminProfile.full_name,
      targetTable: "profiles", targetId: uid, details: `Set status to ${status}`,
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: err?.message || "Unexpected error." }, 500);
  }
});
