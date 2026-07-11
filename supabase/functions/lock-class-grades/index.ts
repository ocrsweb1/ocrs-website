// POST /functions/v1/lock-class-grades
// Faculty who own the class, or an admin, can lock it. This is the ONLY
// way `classes.locked` can be set to true — a DB trigger blocks direct
// client updates to that column (see supabase/migrations/0001_init.sql).
import { corsHeaders, jsonResponse, requireCaller, adminClient, writeAuditLog } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { uid, profile } = await requireCaller(req);
    const { classId } = await req.json();
    if (!classId) return jsonResponse({ error: "classId is required." }, 400);

    const admin = adminClient();
    const { data: cls, error: clsErr } = await admin.from("classes").select("*").eq("id", classId).single();
    if (clsErr || !cls) return jsonResponse({ error: "Class not found." }, 404);

    const isOwner = profile.role === "faculty" && cls.faculty_id === uid;
    const isAdminUser = profile.role === "admin";
    if (!isOwner && !isAdminUser) {
      return jsonResponse({ error: "Only the assigned faculty or an administrator can lock this grade sheet." }, 403);
    }

    const { error: updateErr } = await admin.from("classes").update({
      locked: true, locked_at: new Date().toISOString(), locked_by: uid,
    }).eq("id", classId);
    if (updateErr) return jsonResponse({ error: updateErr.message }, 400);

    await writeAuditLog(admin, {
      action: "LOCK_GRADE_SHEET", performedBy: uid, performedByName: profile.full_name,
      targetTable: "classes", targetId: classId, details: "Grade sheet locked",
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: err?.message || "Unexpected error." }, 500);
  }
});
