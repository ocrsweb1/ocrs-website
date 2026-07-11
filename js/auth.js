// ============================================================
// Authentication helpers shared by all pages.
// Accounts are provisioned by an Administrator via the
// `create-user-account` Edge Function — there is no public sign-up,
// matching the spec's role-controlled account model. Supabase Auth's
// own sign-up is left disabled (see supabase/config.toml enable_signup).
// ============================================================
import { supabase } from "./supabase-config.js";

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const profile = await fetchProfile(data.user.id);
  if (!profile) throw new Error("No profile record found for this account. Contact your administrator.");
  if (profile.status !== "active") {
    await supabase.auth.signOut();
    throw new Error("This account is deactivated. Contact your administrator.");
  }
  return profile;
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}/index.html`,
  });
  if (error) throw error;
}

export async function logout() {
  await supabase.auth.signOut();
  location.href = "index.html";
}

export async function fetchProfile(uid) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).single();
  if (error) return null;
  return data;
}

// Call at the top of student.html / faculty.html / admin.html.
// Redirects to login if unauthenticated, or if role does not match.
export function guardPage(expectedRole, onReady) {
  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) return (location.href = "index.html");
    const profile = await fetchProfile(session.user.id);
    if (!profile || profile.role !== expectedRole || profile.status !== "active") {
      await supabase.auth.signOut();
      return (location.href = "index.html");
    }
    onReady({ uid: session.user.id, ...profile });
  });

  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") location.href = "index.html";
  });
}

export function routeForRole(role) {
  return { student: "student.html", faculty: "faculty.html", admin: "admin.html" }[role] || "index.html";
}
