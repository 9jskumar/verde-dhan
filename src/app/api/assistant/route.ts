import { NextResponse } from "next/server";
import { z } from "zod";
import { assistantEvidence } from "@/lib/ai/assistant-evidence";
import { AiNotConfiguredError, AiOutputError, askAssistant } from "@/lib/ai/claude";
import { verifyAssistantAnswer } from "@/lib/ai/verify";
import { dataMode, getResearch } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const body = z.object({ question: z.string().trim().min(3).max(1000), symbol: z.string().trim().max(20).regex(/^[A-Za-z0-9&-]*$/).optional() });

// Simple per-instance limiter; the Anthropic key is the expensive resource.
const hits = new Map<string, number[]>();
function limited(key: string, perMinute = 6) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > perMinute;
}

export async function POST(req: Request) {
  if (!integrationStatus().claude) return NextResponse.json({ status: "pending_integration", message: "The AI assistant needs ANTHROPIC_API_KEY on the server." }, { status: 503 });
  const mode = dataMode();
  const user = mode === "live" ? await currentUser() : null;
  if (mode === "live" && !user) return NextResponse.json({ message: "Sign in first." }, { status: 401 });
  if (limited(user?.id ?? req.headers.get("x-forwarded-for") ?? "anon")) return NextResponse.json({ message: "Too many questions; wait a minute." }, { status: 429 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Ask a question of 3 to 1000 characters." }, { status: 400 });
  const research = await getResearch();
  if (!research) return NextResponse.json({ message: "No research is stored yet, so there is no evidence to answer from." }, { status: 409 });
  const evidence = assistantEvidence(research, parsed.data.symbol || null);
  if (!evidence) return NextResponse.json({ message: "That symbol is not in the analysed universe." }, { status: 404 });

  try {
    const { answer, meta } = await askAssistant(parsed.data.question, evidence);
    const check = verifyAssistantAnswer(answer, evidence);
    if (!check.accepted) {
      return NextResponse.json({ status: "rejected", message: "The AI answer failed verification against stored data and was withheld.", issues: check.issues }, { status: 422 });
    }
    return NextResponse.json({ status: "ok", answer, isDemo: evidence.isDemo, model: meta.model, evidence: evidence.items.filter((i) => answer.evidenceIds.includes(i.id)) });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ status: "pending_integration", message: e.message }, { status: 503 });
    if (e instanceof AiOutputError) return NextResponse.json({ status: "rejected", message: "The AI answer failed validation and was withheld.", issues: e.issues }, { status: 422 });
    console.error("assistant error", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ message: "The assistant is unavailable right now." }, { status: 502 });
  }
}
