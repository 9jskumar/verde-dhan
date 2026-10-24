import { requireAccount } from "@/components/account";
import { ActionForm, fieldCls } from "@/components/forms";
import { Card, Change, Num, PageHeader, Table, Td } from "@/components/ui";
import { addToWatchlist, createWatchlist, removeFromWatchlist } from "@/lib/data/actions";
import { supabaseForUser } from "@/lib/supabase/server";

interface Row { watchlist_id: string; watchlist_name: string; stock_id: string; symbol: string; company_name: string; added_price: number | null; last_close: number | null; day_change_pct: number | null; return_since_added_pct: number | null }

export default async function WatchlistPage() {
  const gate = await requireAccount("Watchlist");
  const header = <PageHeader title="Watchlist" description="Stocks you are tracking, with the move since you added them. The added price is the stored close at that time." />;
  if (gate) return <>{header}{gate}</>;
  const db = (await supabaseForUser())!;
  const [{ data: lists }, { data: rows }] = await Promise.all([
    db.from("watchlists").select("id,name").order("created_at"),
    db.from("v_watchlist_performance").select("*"),
  ]);
  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card title="New watchlist">
          <ActionForm action={createWatchlist} submit="Create">
            <input name="name" required maxLength={80} placeholder="e.g. Breakout candidates" className={fieldCls} aria-label="Watchlist name" />
          </ActionForm>
        </Card>
        <div className="space-y-4">
          {(lists ?? []).length === 0 && <Card><p className="text-sm text-text-2">No watchlists yet.</p></Card>}
          {(lists ?? []).map((w: { id: string; name: string }) => {
            const items = ((rows ?? []) as Row[]).filter((r) => r.watchlist_id === w.id);
            return (
              <Card key={w.id} title={w.name} subtitle={`${items.length} stocks`}>
                <ActionForm action={addToWatchlist} submit="Add" className="mb-3 flex flex-wrap items-end gap-2 space-y-0">
                  <input type="hidden" name="watchlistId" value={w.id} />
                  <input name="symbol" required placeholder="NSE symbol" className={`${fieldCls} max-w-[12rem] uppercase`} aria-label="NSE symbol" />
                </ActionForm>
                {items.length > 0 && (
                  <Table head={["Stock", "Added at", "Last close", "Day", "Since added", ""]}>
                    {items.map((r) => (
                      <tr key={r.stock_id}>
                        <Td><a className="font-medium hover:underline" href={`/stocks/${r.symbol}`}>{r.symbol}</a><div className="text-xs text-text-3">{r.company_name}</div></Td>
                        <Td><Num value={r.added_price === null ? null : Number(r.added_price)} /></Td>
                        <Td><Num value={r.last_close === null ? null : Number(r.last_close)} /></Td>
                        <Td><Change value={r.day_change_pct === null ? null : Number(r.day_change_pct)} /></Td>
                        <Td><Change value={r.return_since_added_pct === null ? null : Number(r.return_since_added_pct)} /></Td>
                        <Td>
                          <form action={removeFromWatchlist}>
                            <input type="hidden" name="watchlistId" value={w.id} /><input type="hidden" name="stockId" value={r.stock_id} />
                            <button className="text-xs text-text-3 hover:text-loss" type="submit">Remove</button>
                          </form>
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
