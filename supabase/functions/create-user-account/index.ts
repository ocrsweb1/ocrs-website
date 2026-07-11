// POST /functions/v1/create-user-account
// Admin-only. Creates the Supabase Auth user AND the matching
// profiles row in one call, then logs an audit entry.
import { corsHeaders, jsonResponse, requireAdmin, adminClient, writeAuditLog } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { uid: adminUid, profile: adminProfile } = await requireAdmin(req);
    const body = await req.json();
    const { role, fullName, email, password, idNumber, program, yearLevel, section } = body ?? {};

    if (!["student", "faculty", "admin"].includes(role)) return jsonResponse({ error: "Invalid role." }, 400);
    if (!fullName || !email) return jsonResponse({ error: "Full name and email are required." }, 400);
    if (!password || password.length < 8) return jsonResponse({ error: "Password must be at least 8 characters." }, 400);

    const admin = adminClient();

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName, role },
    });
    if (createErr) return jsonResponse({ error: createErr.message }, 409);

    const profileRow = {
      id: created.user.id, full_name: fullName, email, role, status: "active",
      program: program || null, year_level: yearLevel || null, section: section || null,
      created_by: adminUid,
      ...(role === "student" ? { student_number: idNumber || null } : {}),
      ...(role === "faculty" ? { employee_number: idNumber || null } : {}),
    };
    const { error: insertErr } = await admin.from("profiles").insert(profileRow);
    if (insertErr) {
      await admin.auth.admin.deleteUser(created.user.id); // roll back the orphaned auth user
      return jsonResponse({ error: insertErr.message }, 400);
    }

    await writeAuditLog(admin, {
      action: "CREATE_ACCOUNT", performedBy: adminUid, performedByName: adminProfile.full_name,
      targetTable: "profiles", targetId: created.user.id, details: `Created ${role} account for ${fullName} (${email})`,
    });

    return jsonResponse({ uid: created.user.id });
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: err?.message || "Unexpected error." }, 500);
  }
});
