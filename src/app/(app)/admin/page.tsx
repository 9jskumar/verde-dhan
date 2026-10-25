import { requireAccount } from "@/components/account";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { dataMode } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";
import { JOBS } from "@/lib/jobs/definitions";
import { supabaseForUser } from "@/lib/supabase/server";

const LABEL: Record<string, string> = {
  supabase: "Supabase (anon)", supabaseService: "Supabase service role (jobs)", claude: "Anthropic Claude", whatsapp: "WhatsApp Cloud API", whatsappOptIn: "WhatsApp recipient opt-in",
  whatsappWebhook: "WhatsApp webhook", indiaMarketData: "Angel One (stocks, indices, MCX, currency futures)", globalCharts: "TradingView charts (display only)", globalMarketData: "Global index data API", news: "News feeds", cron: "Cron secret", demoMode: "Demo mode",
};

export default async function AdminPage() {
  const header = <PageHeader title="Admin" description="Integration status, scheduled jobs, provider health and data-quality issues." />;
  const status = integrationStatus();
  const integrations = (
    <Card title="Integrations" subtitle="Configured or not; values are never shown">
      <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
        {Object.entries(status).map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-2"><span>{LABEL[k] ?? k}</span>{k === "demoMode" ? <Badge tone={v ? "demo" : "neutral"}>{v ? "on" : "off"}</Badge> : <Badge tone={v ? "gain" : "warn"}>{v ? "configured" : "pending"}</Badge>}</li>
        ))}
      </ul>
    </Card>
  );
  const schedule = (
    <Card title="Job schedule" subtitle="Asia/Kolkata">
      <Table head={["Job", "Cron", "Trading days only", "What it does"]}>
        {JOBS.map((j) => <tr key={j.name}><Td className="num text-xs">{j.name}</Td><Td className="num text-xs">{j.cron}</Td><Td>{j.tradingDaysOnly ? "yes" : "no"}</Td><Td className="text-text-2">{j.description}</Td></tr>)}
      </Table>
    </Card>
  );
  if (dataMode() !== "live") return <>{header}<div className="space-y-4">{integrations}{schedule}</div></>;
  const gate = await requireAccount("Admin");
  if (gate) return <>{header}{gate}</>;
  const db = (await supabaseForUser())!;
  const { data: isAdmin } = await db.rpc("is_admin");
  if (!isAdmin) return <>{header}<Card><p className="text-sm text-text-2">This page is for administrators.</p></Card></>;
  const [{ data: runs }, { data: health }, { data: issues }] = await Promise.all([
    db.from("job_runs").select("job_name, status, started_at, finished_at, skip_reason, error").order("started_at", { ascending: false }).limit(30),
    db.from("provider_health").select("*"),
    db.from("data_quality_issues").select("check_name, severity, entity_type, entity_id, detected_at").is("resolved_at", null).order("detected_at", { ascending: false }).limit(30),
  ]);
  return (
    <>
      {header}
      <div className="space-y-4">
        {integrations}
        <Card title="Recent job runs">
          <Table head={["Job", "Status", "Started", "Finished", "Note"]}>
            {(runs ?? []).map((r, i) => (
              <tr key={i}>
                <Td className="num text-xs">{r.job_name}</Td>
                <Td><Badge tone={r.status === "SUCCEEDED" ? "gain" : r.status === "FAILED" ? "loss" : r.status === "SKIPPED" ? "neutral" : "info"}>{r.status.toLowerCase()}</Badge></Td>
                <Td className="num text-xs">{String(r.started_at).replace("T", " ").slice(0, 19)}</Td>
                <Td className="num text-xs">{r.finished_at ? String(r.finished_at).replace("T", " ").slice(0, 19) : ""}</Td>
                <Td className="max-w-md truncate text-xs text-text-2">{r.error ?? r.skip_reason ?? ""}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Provider health">
            <Table head={["Provider", "Capability", "Circuit", "Failures", "Last success"]}>
              {(health ?? []).map((h, i) => <tr key={i}><Td>{h.provider}</Td><Td>{h.capability}</Td><Td><Badge tone={h.circuit_state === "CLOSED" ? "gain" : "loss"}>{h.circuit_state}</Badge></Td><Td className="num">{h.consecutive_failures}</Td><Td className="num text-xs">{h.last_success_at ? String(h.last_success_at).slice(0, 16) : "never"}</Td></tr>)}
            </Table>
          </Card>
          <Card title="Open data-quality issues">
            <Table head={["Check", "Severity", "Entity", "Detected"]}>
              {(issues ?? []).map((d, i) => <tr key={i}><Td className="text-xs">{d.check_name}</Td><Td><Badge tone={d.severity === "CRITICAL" || d.severity === "ERROR" ? "loss" : "warn"}>{d.severity}</Badge></Td><Td className="text-xs">{d.entity_type} {d.entity_id}</Td><Td className="num text-xs">{String(d.detected_at).slice(0, 16)}</Td></tr>)}
            </Table>
          </Card>
        </div>
        {schedule}
      </div>
    </>
  );
}
