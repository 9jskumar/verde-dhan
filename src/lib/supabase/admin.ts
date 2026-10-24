import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

/**
 * Service-role client for ingestion workers, scheduled jobs and webhooks.
 * Bypasses RLS: never import from client components or use it to serve
 * user-specific data. Returns null when the service key is not configured.
 */
let client: SupabaseClient | null | undefined;

export function supabaseAdmin(): SupabaseClient | null {
  if (client !== undefined) return client;
  const e = env();
  client =
    e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return client;
}
