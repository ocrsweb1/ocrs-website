// Shared helpers for all OCRS Edge Functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // tighten to your Netlify domain in production, e.g. "https://your-site.netlify.app"
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Client scoped to the caller's own JWT — respects RLS exactly like the
// browser would, so we can safely use it to read the caller's own profile.
export function callerClient(req) {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authHeader } } }
  );
}

// Admin client using the service role key — bypasses RLS entirely.
// Only ever used inside Edge Functions, never shipped to the browser.
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );
}

// Resolves the calling user + their profile row, or throws a Response-friendly error.
export async function requireCaller(req) {
  const supabase = callerClient(req);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw jsonResponse({ error: "Sign in required." }, 401);

  const { data: profile, error: profileErr } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();
  if (profileErr || !profile) throw jsonResponse({ error: "No profile found for this account." }, 403);
  if (profile.status !== "active") throw jsonResponse({ error: "Account is not active." }, 403);

  return { uid: user.id, profile };
}

export async function requireAdmin(req) {
  const caller = await requireCaller(req);
  if (caller.profile.role !== "admin") throw jsonResponse({ error: "Administrator access required." }, 403);
  return caller;
}

export async function writeAuditLog(admin, { action, performedBy, performedByName, targetTable, targetId, details }) {
  await admin.from("audit_logs").insert({
    action, performed_by: performedBy, performed_by_name: performedByName ?? null,
    target_table: targetTable ?? null, target_id: targetId ?? null, details: details ?? null,
  });
}
