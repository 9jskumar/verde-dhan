import { requireAccount } from "@/components/account";
import { ActionForm, fieldCls } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { savePreferences } from "@/lib/data/actions";
import { supabaseForUser } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const header = <PageHeader title="Settings" description="Personal defaults used by the risk calculator and pages. The theme switch is in the top bar." />;
  const gate = await requireAccount("Settings");
  if (gate) return <>{header}{gate}</>;
  const db = (await supabaseForUser())!;
  const { data: p } = await db.from("user_preferences").select("*").maybeSingle();
  return (
    <>
      {header}
      <Card title="Trading defaults" className="max-w-lg">
        <ActionForm action={savePreferences} submit="Save">
          <label className="block text-xs text-text-2">Risk per trade (% of capital)<input name="riskPerTradePct" type="number" step="0.1" min="0.1" max="10" defaultValue={p?.risk_per_trade_pct ?? 1} className={fieldCls} /></label>
          <label className="block text-xs text-text-2">Trading capital ₹ (optional)<input name="capitalInr" type="number" step="any" min="0" defaultValue={p?.capital_inr ?? ""} className={fieldCls} /></label>
          <label className="block text-xs text-text-2">Default exchange<select name="defaultExchange" defaultValue={p?.default_exchange ?? "NSE"} className={fieldCls}><option>NSE</option><option>BSE</option></select></label>
        </ActionForm>
      </Card>
    </>
  );
}
