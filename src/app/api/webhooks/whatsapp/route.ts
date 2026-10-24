import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseStatusWebhook, verifyWebhookSignature, verifyWebhookSubscription } from "@/lib/whatsapp/client";

export const dynamic = "force-dynamic";

/** Meta subscription handshake. */
export async function GET(req: Request) {
  const token = env().WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!token) return new NextResponse("not configured", { status: 503 });
  const challenge = verifyWebhookSubscription(new URL(req.url).searchParams, token);
  return challenge ? new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } }) : new NextResponse("forbidden", { status: 403 });
}

/** Delivery status callbacks. Signed with the app secret; anything unsigned is dropped. */
export async function POST(req: Request) {
  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret) return new NextResponse("not configured", { status: 503 });
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), secret)) return new NextResponse("bad signature", { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }
  const statuses = parseStatusWebhook(payload);
  const db = supabaseAdmin();
  if (db && statuses.length) {
    const { error } = await db.from("notification_delivery_status").upsert(
      statuses.map((s) => ({ provider_message_id: s.providerMessageId, status: s.status, status_timestamp: s.timestamp, error_code: s.errorCode, error_title: s.errorTitle })),
      { onConflict: "provider_message_id,status", ignoreDuplicates: true },
    );
    // Returning 500 makes Meta retry, which is what we want if the write failed.
    if (error) return new NextResponse("store failed", { status: 500 });
  }
  return NextResponse.json({ received: statuses.length });
}
