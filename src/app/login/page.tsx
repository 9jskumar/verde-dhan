import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { dataMode } from "@/lib/data/repository";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const mode = dataMode();
  if (mode === "live" && (await currentUser())) redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <p className="mb-6 flex items-center gap-2 text-sm font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded bg-brand text-[11px] font-bold text-white dark:text-bg">VD</span>Verde Dhan</p>
      <h1 className="text-xl font-semibold">Sign in</h1>
      {mode === "live" ? (
        <LoginForm url={env().NEXT_PUBLIC_SUPABASE_URL!} anonKey={env().NEXT_PUBLIC_SUPABASE_ANON_KEY!} />
      ) : (
        <p className="mt-3 text-sm text-text-2">
          Accounts need Supabase to be configured. {mode === "demo" ? <>The app is running in demo mode; <Link className="text-accent underline" href="/">open the demo</Link>.</> : "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."}
        </p>
      )}
    </main>
  );
}
