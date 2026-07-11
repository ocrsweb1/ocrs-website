// ============================================================
// Supabase client initialization — plain ES module, no bundler.
// Fill in your project URL + anon (public) key from
// Supabase Dashboard > Project Settings > API.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TODO: replace with your project's values. The anon key is safe to
// expose client-side — it identifies your project and is subject to
// Row Level Security; it authorizes nothing by itself.
const SUPABASE_URL = "https://vlyhswezqzsgxwyclbsq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZseWhzd2V6cXpzZ3h3eWNsYnNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NjI3MDgsImV4cCI6MjA5OTMzODcwOH0.ANOWiSbyc6rTR4XiJF-ayaNy3sJCR5NeN0RPglljI8A";

// Local development: open the site with ?local=1 (e.g.
// http://localhost:8888/index.html?local=1) to point at
// `supabase start` instead of your hosted project.
const wantsLocal = new URLSearchParams(location.search).get("local") === "1";

const url = wantsLocal ? "http://127.0.0.1:54321" : SUPABASE_URL;
const anonKey = wantsLocal
  ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0" // standard Supabase CLI local anon key
  : SUPABASE_ANON_KEY;

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

if (wantsLocal) console.info("[OCRS] Connected to local Supabase (supabase start)");
