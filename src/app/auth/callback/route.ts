import { NextResponse } from "next/server";
import { supabaseForUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Completes the email-link sign-in by exchanging the one-time code for a session cookie. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const sb = await supabaseForUser();
  if (code && sb) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
