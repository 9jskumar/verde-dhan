import { requireAccount } from "@/components/account";
import { ActionForm, fieldCls } from "@/components/forms";
import { Card, Change, Num, PageHeader, Table, Td } from "@/components/ui";
import { createPortfolio, recordTransaction } from "@/lib/data/actions";
import { allocation, summariseHoldings, type Transaction } from "@/lib/quant/risk";
import { supabaseForUser } from "@/lib/supabase/server";

export default async function PortfolioPage() {
  const gate = await requireAccount("Portfolio");
  const header = <PageHeader title="Portfolio" description="Record your own trades to track holdings and P&L (FIFO). Verde Dhan never places orders." />;
  if (gate) return <>{header}{gate}</>;
  const db = (await supabaseForUser())!;
  const { data: portfolios } = await db.from("portfolios").select("id,name").order("created_at");
  const { data: txRows } = await db.from("portfolio_transactions").select("portfolio_id, side, quantity, price, fees, executed_at, stocks(symbol)").order("executed_at");
  const symbols = [...new Set((txRows ?? []).map((t) => (t.stocks as unknown as { symbol: string } | null)?.symbol).filter(Boolean))] as string[];
  const { data: px } = symbols.length ? await db.from("v_latest_stock_prices").select("symbol, close").eq("exchange", "NSE").in("symbol", symbols) : { data: [] };
  const prices = Object.fromEntries((px ?? []).map((p: { symbol: string; close: number }) => [p.symbol, Number(p.close)]));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-4">
          <Card title="New portfolio">
            <ActionForm action={createPortfolio} submit="Create"><input name="name" required maxLength={80} className={fieldCls} aria-label="Portfolio name" /></ActionForm>
          </Card>
          {(portfolios ?? []).length > 0 && (
            <Card title="Record a transaction">
              <ActionForm action={recordTransaction} submit="Record">
                <select name="portfolioId" className={fieldCls} aria-label="Portfolio">{(portfolios ?? []).map((p: { id: string; name: string }) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input name="symbol" required placeholder="NSE symbol" className={`${fieldCls} uppercase`} aria-label="Symbol" />
                <select name="side" className={fieldCls} aria-label="Side"><option>BUY</option><option>SELL</option></select>
                <input name="quantity" type="number" min="0" step="any" required placeholder="Quantity" className={fieldCls} aria-label="Quantity" />
                <input name="price" type="number" min="0" step="any" required placeholder="Price ₹" className={fieldCls} aria-label="Price" />
                <input name="fees" type="number" min="0" step="any" placeholder="Fees ₹" className={fieldCls} aria-label="Fees" />
                <input name="executedAt" type="date" required max={today} defaultValue={today} className={fieldCls} aria-label="Trade date" />
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {(portfolios ?? []).length === 0 && <Card><p className="text-sm text-text-2">No portfolios yet.</p></Card>}
          {(portfolios ?? []).map((p: { id: string; name: string }) => {
            const txs: Transaction[] = (txRows ?? []).filter((t) => t.portfolio_id === p.id).map((t) => ({
              symbol: (t.stocks as unknown as { symbol: string }).symbol, side: t.side as "BUY" | "SELL", quantity: Number(t.quantity), price: Number(t.price), fees: Number(t.fees), executedAt: t.executed_at as string,
            }));
            const holdings = summariseHoldings(txs, prices).filter((h) => h.quantity > 0 || h.realisedPnl !== 0);
            const alloc = Object.fromEntries(allocation(holdings.map((h) => ({ key: h.symbol, value: h.currentValue }))).map((a) => [a.key, a.pct]));
            const invested = holdings.reduce((s, h) => s + h.investedValue, 0);
            const current = holdings.every((h) => h.currentValue !== null) ? holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0) : null;
            return (
              <Card key={p.id} title={p.name} subtitle={`Invested ₹${invested.toLocaleString("en-IN", { maximumFractionDigits: 0 })}${current !== null ? ` · current ₹${current.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : " · current value needs prices for every holding"}`}>
                {holdings.length ? (
                  <Table head={["Stock", "Qty", "Avg cost", "Last", "Value", "Unrealised", "Realised", "Weight %"]}>
                    {holdings.map((h) => (
                      <tr key={h.symbol}>
                        <Td className="font-medium">{h.symbol}</Td>
                        <Td><Num value={h.quantity} dp={0} /></Td>
                        <Td><Num value={h.averageCost} /></Td>
                        <Td><Num value={h.currentPrice} /></Td>
                        <Td><Num value={h.currentValue} dp={0} /></Td>
                        <Td><Num value={h.unrealisedPnl} dp={0} /> <Change value={h.unrealisedPnlPct} className="text-xs" /></Td>
                        <Td><Num value={h.realisedPnl} dp={0} /></Td>
                        <Td><Num value={alloc[h.symbol] ?? null} dp={1} /></Td>
                      </tr>
                    ))}
                  </Table>
                ) : <p className="text-sm text-text-3">No transactions yet.</p>}
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
