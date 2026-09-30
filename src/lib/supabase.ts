import { createClient } from "@supabase/supabase-js";

/** Vite inlines VITE_* at startup. KEY==value in .env becomes a leading '=' on the JWT. */
function readViteEnv(name: string): string | undefined {
  const raw = import.meta.env[name];
  if (typeof raw !== "string") return undefined;
  let value = raw.trim();
  if (name.endsWith("_KEY")) {
    value = value.replace(/^=+/, "");
  }
  return value || undefined;
}

const url = readViteEnv("VITE_SUPABASE_URL");
const key = readViteEnv("VITE_SUPABASE_ANON_KEY");

export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;