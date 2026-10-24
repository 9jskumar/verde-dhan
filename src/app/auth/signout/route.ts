import { NextResponse } from "next/server";
import { supabaseForUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await supabaseForUser();
  await sb?.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
