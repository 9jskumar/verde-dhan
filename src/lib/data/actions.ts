"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseForUser } from "../supabase/server";

/**
 * Mutations run as the signed-in user, so RLS decides what they may touch.
 * Each returns a message instead of throwing so forms can show it.
 */

export interface ActionResult { ok: boolean; message: string }

async function db() {
  const sb = await supabaseForUser();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ? sb : null;
}

async function stockId(sb: NonNullable<Awaited<ReturnType<typeof db>>>, symbol: string): Promise<string | null> {
  const { data } = await sb.from("stocks").select("id").eq("symbol", symbol.trim().toUpperCase()).eq("exchange", "NSE").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

const nameSchema = z.string().trim().min(1).max(80);
const symbolSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9&\-]+$/);

export async function createWatchlist(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const sb = await db();
  if (!sb) return { ok: false, message: "Sign in first." };
  const name = nameSchema.safeParse(form.get("name"));
  if (!name.success) return { ok: false, message: "Name must be 1 to 80 characters." };
  const { error } = await sb.from("watchlists").insert({ name: name.data });
  revalidatePath("/watchlist");
  return error ? { ok: false, message: error.code === "23505" ? "You already have a watchlist with that name." : "Could not create the watchlist." } : { ok: true, message: "Watchlist created." };
}

export async function addToWatchlist(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const sb = await db();
  if (!sb) return { ok: false, message: "Sign in first." };
  const parsed = z.object({ watchlistId: z.uuid(), symbol: symbolSchema }).safeParse({ watchlistId: form.get("watchlistId"), symbol: form.get("symbol") });
  if (!parsed.success) return { ok: false, message: "Enter a valid NSE symbol." };
  const id = await stockId(sb, parsed.data.symbol);
  if (!id) return { ok: false, message: `${parsed.data.symbol.toUpperCase()} is not in the tracked universe.` };
  // added_price comes from the stored latest close, never from user input.
  const { data: px } = await sb.from("v_latest_stock_prices").select("close").eq("stock_id", id).maybeSingle();
  const { error } = await sb.from("watchlist_stocks").insert({ watchlist_id: parsed.data.watchlistId, stock_id: id, added_price: px?.close ?? null });
  revalidatePath("/watchlist");
  return error ? { ok: false, message: error.code === "23505" ? "Already on this watchlist." : "Could not add the stock." } : { ok: true, message: "Added." };
}

export async function removeFromWatchlist(form: FormData): Promise<void> {
  const sb = await db();
  if (!sb) return;
  const parsed = z.object({ watchlistId: z.uuid(), stockId: z.uuid() }).safeParse({ watchlistId: form.get("watchlistId"), stockId: form.get("stockId") });
  if (!parsed.success) return;
  await sb.from("watchlist_stocks").delete().eq("watchlist_id", parsed.data.watchlistId).eq("stock_id", parsed.data.stockId);
  revalidatePath("/watchlist");
}

export async function createPortfolio(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const sb = await db();
  if (!sb) return { ok: false, message: "Sign in first." };
  const name = nameSchema.safeParse(form.get("name"));
  if (!name.success) return { ok: false, message: "Name must be 1 to 80 characters." };
  const { error } = await sb.from("portfolios").insert({ name: name.data });
  revalidatePath("/portfolio");
  return error ? { ok: false, message: "Could not create the portfolio." } : { ok: true, message: "Portfolio created." };
}

const txSchema = z.object({
  portfolioId: z.uuid(),
  symbol: symbolSchema,
  side: z.enum(["BUY", "SELL"]),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().positive(),
  fees: z.coerce.number().min(0).default(0),
  executedAt: z.iso.date(),
});

export async function recordTransaction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const sb = await db();
  if (!sb) return { ok: false, message: "Sign in first." };
  const parsed = txSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the symbol, quantity, price and date." };
  const t = parsed.data;
  const id = await stockId(sb, t.symbol);
  if (!id) return { ok: false, message: `${t.symbol.toUpperCase()} is not in the tracked universe.` };
  const { error } = await sb.from("portfolio_transactions").insert({ portfolio_id: t.portfolioId, stock_id: id, side: t.side, quantity: t.quantity, price: t.price, fees: t.fees, executed_at: `${t.executedAt}T00:00:00+05:30` });
  revalidatePath("/portfolio");
  return error ? { ok: false, message: "Could not record the transaction." } : { ok: true, message: "Transaction recorded. This only updates your records; nothing is traded." };
}

const prefsSchema = z.object({
  riskPerTradePct: z.coerce.number().gt(0).max(10),
  capitalInr: z.union([z.literal(""), z.coerce.number().positive()]),
  defaultExchange: z.enum(["NSE", "BSE"]),
});

export async function savePreferences(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const sb = await db();
  if (!sb) return { ok: false, message: "Sign in first." };
  const parsed = prefsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Risk per trade must be between 0 and 10%." };
  const { data: u } = await sb.auth.getUser();
  const p = parsed.data;
  const { error } = await sb.from("user_preferences").upsert({ user_id: u.user!.id, risk_per_trade_pct: p.riskPerTradePct, capital_inr: p.capitalInr === "" ? null : p.capitalInr, default_exchange: p.defaultExchange, updated_at: new Date().toISOString() });
  revalidatePath("/settings");
  return error ? { ok: false, message: "Could not save preferences." } : { ok: true, message: "Saved." };
}

export async function saveNotificationPreferences(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const sb = await db();
  if (!sb) return { ok: false, message: "Sign in first." };
  const { data: u } = await sb.auth.getUser();
  const on = (k: string) => form.get(k) === "on";
  const { error } = await sb.from("notification_preferences").upsert({
    user_id: u.user!.id,
    global_premarket: on("global_premarket"),
    india_premarket: on("india_premarket"),
    daily_close: on("daily_close"),
    exceptional_alerts: on("exceptional_alerts"),
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/notifications");
  return error ? { ok: false, message: "Could not save notification settings." } : { ok: true, message: "Saved." };
}
