import { dataMode } from "@/lib/data/repository";
import { EmptyState, PendingIntegration } from "./ui";

/** Shown when no analysis run is stored yet. */
export function NoResearch() {
  if (dataMode() === "unconfigured")
    return <PendingIntegration feature="Stock research" needs={["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "a market data provider", "or DEMO_MODE=true"]} />;
  return <EmptyState title="No analysis run stored yet">The daily analysis job writes results after the close. Run it with <span className="num">npm run job -- compute_analysis</span>.</EmptyState>;
}
