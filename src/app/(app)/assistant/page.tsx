import { AssistantChat } from "@/components/assistant-chat";
import { Card, PageHeader, PendingIntegration } from "@/components/ui";
import { integrationStatus } from "@/lib/env";

export default function AssistantPage() {
  const enabled = integrationStatus().claude;
  return (
    <>
      <PageHeader title="AI Research Assistant" description="Ask about the stored analysis. Claude only sees the evidence pack built from computed data, and any answer containing a number that is not in that pack is withheld." />
      {!enabled && <div className="mb-4"><PendingIntegration feature="AI assistant" needs={["ANTHROPIC_API_KEY"]} /></div>}
      <Card><AssistantChat enabled={enabled} /></Card>
    </>
  );
}
