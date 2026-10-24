import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta WhatsApp Business Cloud API client (server-side only).
 *
 * Business-initiated messages outside the 24-hour customer-service window
 * must use a pre-approved template, so all scheduled reports are template
 * messages whose body parameters carry the report text.
 */

export const E164 = /^\+[1-9]\d{7,14}$/;

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
}

export interface TemplateMessage {
  to: string;
  template: string;
  languageCode: string;
  bodyParams: string[];
}

export interface SendResult {
  ok: boolean;
  status: number;
  messageId: string | null;
  retryable: boolean;
  /** Provider response with recipient identifiers removed. */
  response: unknown;
}

/** Meta rejects template params containing newlines/tabs or >4 consecutive spaces (error 132018). */
export function sanitizeTemplateParam(text: string, maxLength = 1000): string {
  const cleaned = text
    .replace(/\s*[\r\n\t]+\s*/g, " · ")
    .replace(/ {4,}/g, "   ")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

export function validateTemplateMessage(m: TemplateMessage): string[] {
  const issues: string[] = [];
  if (!E164.test(m.to)) issues.push("recipient is not a valid E.164 number");
  if (!/^[a-z0-9_]{1,512}$/.test(m.template)) issues.push("template name must be lowercase snake_case");
  if (m.bodyParams.some((p) => p.length === 0)) issues.push("empty template parameter");
  if (m.bodyParams.some((p) => /[\r\n\t]/.test(p) || / {5,}/.test(p))) issues.push("template parameter has newline/tab or long whitespace");
  return issues;
}

export function recipientHash(e164: string): string {
  return createHash("sha256").update(e164).digest("hex").slice(0, 32);
}

/** Masks phone numbers anywhere in a provider response before it is logged or stored. */
export function redactPhones<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null).replace(/\+?\d{10,15}/g, (m) => `${m.slice(0, 3)}***${m.slice(-2)}`)) as T;
}

export async function sendTemplate(cfg: WhatsAppConfig, msg: TemplateMessage): Promise<SendResult> {
  const issues = validateTemplateMessage(msg);
  if (issues.length) return { ok: false, status: 0, messageId: null, retryable: false, response: { validation: issues } };
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: msg.to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: msg.template,
      language: { code: msg.languageCode },
      components: msg.bodyParams.length ? [{ type: "body", parameters: msg.bodyParams.map((text) => ({ type: "text", text })) }] : [],
    },
  };
  const f = cfg.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, messageId: null, retryable: true, response: { error: "network error" } };
  }
  const json = (await res.json().catch(() => null)) as { messages?: { id: string }[]; error?: { code?: number } } | null;
  const messageId = json?.messages?.[0]?.id ?? null;
  // 131056 = pair rate limit; 130429 = throughput limit; 5xx = transient.
  const code = json?.error?.code;
  const retryable = res.status >= 500 || res.status === 429 || code === 131056 || code === 130429;
  return { ok: res.ok && Boolean(messageId), status: res.status, messageId, retryable, response: redactPhones(json) };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** GET verification handshake. Returns the challenge to echo, or null. */
export function verifyWebhookSubscription(params: URLSearchParams, verifyToken: string): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || !token || !challenge) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

/** Validates X-Hub-Signature-256 over the raw request body. */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const got = header.slice(7);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
}

export interface DeliveryStatus {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed" | "deleted" | "warning";
  timestamp: string;
  errorCode: string | null;
  errorTitle: string | null;
}

export function parseStatusWebhook(payload: unknown): DeliveryStatus[] {
  const out: DeliveryStatus[] = [];
  const entries = (payload as { entry?: { changes?: { value?: { statuses?: unknown[] } }[] }[] })?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const raw of change.value?.statuses ?? []) {
        const s = raw as { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string }[] };
        if (!s.id || !s.status || !s.timestamp) continue;
        if (!["sent", "delivered", "read", "failed", "deleted", "warning"].includes(s.status)) continue;
        out.push({
          providerMessageId: s.id,
          status: s.status as DeliveryStatus["status"],
          timestamp: new Date(Number(s.timestamp) * 1000).toISOString(),
          errorCode: s.errors?.[0]?.code?.toString() ?? null,
          errorTitle: s.errors?.[0]?.title ?? null,
        });
      }
    }
  }
  return out;
}
