"use client";
import { useState } from "react";
import { buttonVariants } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Passwordless email sign-in: the only personal data collected is the email address. */
export function LoginForm({ url, anonKey }: { url: string; anonKey: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending");
        const { error } = await supabaseBrowser(url, anonKey).auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
        setState(error ? "error" : "sent");
      }}
    >
      <label className="block text-sm">
        Email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-line bg-bg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
      </label>
      <button type="submit" disabled={state === "sending"} className={buttonVariants({ className: "w-full" })}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
      {state === "sent" && <p role="status" className="text-sm text-gain">Check your inbox for the sign-in link.</p>}
      {state === "error" && <p role="alert" className="text-sm text-loss">Could not send the link. Try again shortly.</p>}
    </form>
  );
}
