import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "../env";

/** Per-request client acting as the signed-in user, so RLS applies. */
export async function supabaseForUser(): Promise<SupabaseClient | null> {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const store = await cookies();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server components cannot set cookies; the proxy refreshes sessions.
        }
      },
    },
  });
}

export async function currentUser() {
  const sb = await supabaseForUser();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}
