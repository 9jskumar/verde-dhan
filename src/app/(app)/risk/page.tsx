import { RiskCalculator } from "@/components/risk-calculator";
import { Card, PageHeader } from "@/components/ui";
import { dataMode } from "@/lib/data/repository";
import { currentUser, supabaseForUser } from "@/lib/supabase/server";

export default async function RiskPage() {
  let defaults = { capital: null as number | null, riskPct: 1 };
  if (dataMode() === "live" && (await currentUser())) {
    const db = (await supabaseForUser())!;
    const { data } = await db.from("user_preferences").select("capital_inr, risk_per_trade_pct").maybeSingle();
    if (data) defaults = { capital: data.capital_inr === null ? null : Number(data.capital_inr), riskPct: Number(data.risk_per_trade_pct) };
  }
  return (
    <>
      <PageHeader title="Risk Management" description="Size a position from the amount you are willing to lose if the stop-loss is hit." />
      <Card title="Position size calculator" subtitle="Runs in your browser; nothing is sent or stored">
        <RiskCalculator defaults={defaults} />
      </Card>
    </>
  );
}
