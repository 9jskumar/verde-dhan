import { requireAccount } from "@/components/account";
import { ActionForm } from "@/components/forms";
import { Badge, Card, PageHeader, PendingIntegration, Table, Td } from "@/components/ui";
import { saveNotificationPreferences } from "@/lib/data/actions";
import { dataMode } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";
import { supabaseForUser } from "@/lib/supabase/server";

const SCHEDULE = [
  { key: "global_premarket", label: "Global pre-market", time: "08:00 IST", template: "vd_global_premarket" },
  { key: "india_premarket", label: "Indian pre-market opportunities", time: "08:30 IST", template: "vd_india_premarket" },
  { key: "daily_close", label: "Daily closing report", time: "16:30 IST", template: "vd_daily_close" },
  { key: "exceptional_alerts", label: "Exceptional alerts", time: "Market hours, threshold-based", template: "vd_exceptional_alert" },
] as const;

export default async function NotificationsPage() {
  const s = integrationStatus();
  const mode = dataMode();
  let prefs: Record<string, boolean> | null = null;
  let templates: { name: string; meta_status: string }[] = [];
  const gate = mode === "live" ? await requireAccount("Notification preferences") : null;
  if (mode === "live" && !gate) {
    const db = (await supabaseForUser())!;
    const [{ data: p }, { data: t }] = await Promise.all([db.from("notification_preferences").select("*").maybeSingle(), db.from("whatsapp_templates").select("name, meta_status")]);
    prefs = p ?? null;
    templates = t ?? [];
  }
  return (
    <>
      <PageHeader title="WhatsApp Notifications" description="Scheduled reports through the WhatsApp Business Cloud API using Meta-approved templates. Messages only go to numbers that have opted in." />
      <div className="mb-4 space-y-2">
        {!s.whatsapp && <PendingIntegration feature="WhatsApp delivery" needs={["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_RECIPIENT"]} />}
        {s.whatsapp && !s.whatsappOptIn && <PendingIntegration feature="Primary recipient opt-in" needs={["WHATSAPP_RECIPIENT_OPTED_IN=true (only after recording the recipient's consent)"]} />}
        {!s.whatsappWebhook && <PendingIntegration feature="Delivery receipts" needs={["WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"]} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Schedule" subtitle="Indian trading days only; holidays come from the market_holidays table">
          <Table head={["Report", "When", "Template", "Meta status"]}>
            {SCHEDULE.map((r) => {
              const st = templates.find((t) => t.name === r.template)?.meta_status;
              return (
                <tr key={r.key}>
                  <Td>{r.label}</Td>
                  <Td className="text-text-2">{r.time}</Td>
                  <Td className="num text-xs">{r.template}</Td>
                  <Td>{st ? <Badge tone={st === "APPROVED" ? "gain" : st === "REJECTED" ? "loss" : "warn"}>{st.toLowerCase()}</Badge> : <span className="text-xs text-text-3">unknown</span>}</Td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-3 text-xs text-text-3">Business-initiated WhatsApp messages must use templates approved in Meta Business Manager. See WHATSAPP_TEMPLATES.md for the exact template text to submit.</p>
        </Card>
        <Card title="Your preferences">
          {gate ?? (mode !== "live" ? <p className="text-sm text-text-3">Preferences are stored per account and need Supabase.</p> : (
            <ActionForm action={saveNotificationPreferences} submit="Save">
              {SCHEDULE.map((r) => (
                <label key={r.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name={r.key} defaultChecked={prefs ? Boolean(prefs[r.key]) : true} /> {r.label}</label>
              ))}
              <p className="text-xs text-text-3">Adding your own WhatsApp number requires explicit consent and is handled by an administrator.</p>
            </ActionForm>
          ))}
        </Card>
      </div>
    </>
  );
}
