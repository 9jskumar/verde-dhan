import { NextResponse } from "next/server";
import { dataMode } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

/** Liveness for uptime monitors. Integration detail is on the admin page only. */
export async function GET() {
  return NextResponse.json({ ok: true, mode: dataMode(), time: new Date().toISOString() });
}
