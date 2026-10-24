import { round } from "./types";

/** Position sizing, risk/reward and portfolio P&L. Pure functions. */

export interface PositionSizeInput {
  capital: number;
  /** % of capital the user accepts to lose if the stop is hit, e.g. 1. */
  riskPerTradePct: number;
  entry: number;
  stopLoss: number;
  /** Optional cap on position value as % of capital (concentration limit). */
  maxPositionPct?: number;
  lotSize?: number;
}

export interface PositionSizeResult {
  quantity: number;
  positionValue: number;
  riskAmount: number;
  riskPerShare: number;
  positionPctOfCapital: number;
  cappedByConcentration: boolean;
}

export function positionSize(input: PositionSizeInput): PositionSizeResult {
  const { capital, riskPerTradePct, entry, stopLoss, maxPositionPct = 100, lotSize = 1 } = input;
  if (!(capital > 0)) throw new RangeError("capital must be positive");
  if (!(entry > 0)) throw new RangeError("entry must be positive");
  if (!(riskPerTradePct > 0 && riskPerTradePct <= 100)) throw new RangeError("risk per trade must be in (0, 100]");
  if (!(stopLoss < entry)) throw new RangeError("stop-loss must be below entry for a long position");
  const riskPerShare = entry - stopLoss;
  const riskBudget = (capital * riskPerTradePct) / 100;
  let qty = Math.floor(riskBudget / riskPerShare / lotSize) * lotSize;
  const maxQty = Math.floor((capital * maxPositionPct) / 100 / entry / lotSize) * lotSize;
  const capped = qty > maxQty;
  if (capped) qty = maxQty;
  return {
    quantity: qty,
    positionValue: round(qty * entry, 2)!,
    riskAmount: round(qty * riskPerShare, 2)!,
    riskPerShare: round(riskPerShare, 4)!,
    positionPctOfCapital: round(((qty * entry) / capital) * 100, 2)!,
    cappedByConcentration: capped,
  };
}

export function riskReward(entry: number, stopLoss: number, target: number): number | null {
  const risk = entry - stopLoss;
  if (!(risk > 0) || !(target > entry)) return null;
  return round((target - entry) / risk, 2);
}

export interface Transaction {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fees?: number;
  executedAt: string;
}

export interface HoldingSummary {
  symbol: string;
  quantity: number;
  averageCost: number;
  investedValue: number;
  currentPrice: number | null;
  currentValue: number | null;
  unrealisedPnl: number | null;
  unrealisedPnlPct: number | null;
  realisedPnl: number;
}

/**
 * FIFO lot matching. Fees on buys are capitalised into cost; fees on sells
 * reduce realised P&L. Short selling is not supported: a sell larger than
 * the open quantity throws.
 */
export function summariseHoldings(
  transactions: readonly Transaction[],
  prices: Record<string, number | null | undefined>,
): HoldingSummary[] {
  const bySymbol = new Map<string, Transaction[]>();
  for (const t of [...transactions].sort((a, b) => a.executedAt.localeCompare(b.executedAt))) {
    if (!(t.quantity > 0) || !(t.price > 0)) throw new RangeError(`invalid transaction for ${t.symbol}`);
    bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  }
  const out: HoldingSummary[] = [];
  for (const [symbol, txs] of bySymbol) {
    const lots: { qty: number; cost: number }[] = [];
    let realised = 0;
    for (const t of txs) {
      if (t.side === "BUY") {
        lots.push({ qty: t.quantity, cost: (t.price * t.quantity + (t.fees ?? 0)) / t.quantity });
      } else {
        let remaining = t.quantity;
        const open = lots.reduce((s, l) => s + l.qty, 0);
        if (remaining > open + 1e-9) throw new RangeError(`sell of ${remaining} ${symbol} exceeds open quantity ${open}`);
        realised -= t.fees ?? 0;
        while (remaining > 1e-9) {
          const lot = lots[0]!;
          const used = Math.min(lot.qty, remaining);
          realised += used * (t.price - lot.cost);
          lot.qty -= used;
          remaining -= used;
          if (lot.qty <= 1e-9) lots.shift();
        }
      }
    }
    const quantity = lots.reduce((s, l) => s + l.qty, 0);
    const invested = lots.reduce((s, l) => s + l.qty * l.cost, 0);
    const price = prices[symbol] ?? null;
    const currentValue = price === null ? null : quantity * price;
    out.push({
      symbol,
      quantity,
      averageCost: quantity > 0 ? round(invested / quantity, 4)! : 0,
      investedValue: round(invested, 2)!,
      currentPrice: price,
      currentValue: currentValue === null ? null : round(currentValue, 2),
      unrealisedPnl: currentValue === null ? null : round(currentValue - invested, 2),
      unrealisedPnlPct: currentValue === null || invested === 0 ? null : round(((currentValue - invested) / invested) * 100, 2),
      realisedPnl: round(realised, 2)!,
    });
  }
  return out;
}

export function allocation(holdings: readonly { key: string; value: number | null }[]) {
  const total = holdings.reduce((s, h) => s + (h.value ?? 0), 0);
  return holdings.map((h) => ({ key: h.key, pct: total > 0 && h.value !== null ? round((h.value / total) * 100, 2) : null }));
}

/** Maximum drawdown in % of a value series (e.g. equity curve). */
export function maxDrawdownPct(values: readonly number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) mdd = Math.min(mdd, (v - peak) / peak);
  }
  return round(mdd * 100, 2)!;
}
