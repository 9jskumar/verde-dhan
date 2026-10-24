import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell";
import { dataMode } from "@/lib/data/repository";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const mode = dataMode();
  const user = mode === "live" ? await currentUser() : null;
  // Market data is licensed for signed-in users only.
  if (mode === "live" && !user) redirect("/login");
  return (
    <AppShell mode={mode} userEmail={user?.email ?? null}>
      {children}
    </AppShell>
  );
}
