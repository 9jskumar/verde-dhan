"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client for auth flows only; uses the public anon key. */
export function supabaseBrowser(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey);
}
