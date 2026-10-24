import Link from "next/link";
import { dataMode } from "@/lib/data/repository";
import { currentUser } from "@/lib/supabase/server";
import { EmptyState, PendingIntegration } from "./ui";

/** Returns a placeholder when the page needs a signed-in Supabase user, else null. */
export async function requireAccount(feature: string) {
  const mode = dataMode();
  if (mode === "demo")
    return <EmptyState title={`${feature} needs an account`}>Demo mode has no user accounts, so there is nothing to show here. Personal data is never simulated.</EmptyState>;
  if (mode === "unconfigured") return <PendingIntegration feature={feature} needs={["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]} />;
  const user = await currentUser();
  if (!user) return <EmptyState title="Sign in to continue"><Link className="text-accent underline" href="/login">Sign in</Link></EmptyState>;
  return null;
}
