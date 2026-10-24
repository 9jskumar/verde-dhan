"use client";
import { type ReactNode, useActionState } from "react";
import type { ActionResult } from "@/lib/data/actions";
import { buttonVariants, cn } from "./ui";

export const fieldCls = "h-9 w-full rounded-md border border-line bg-bg px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40";

/** Wraps a server action with pending state and an inline result message. */
export function ActionForm({ action, children, submit, className }: { action: (s: ActionResult | null, f: FormData) => Promise<ActionResult>; children: ReactNode; submit: string; className?: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={cn("space-y-2", className)}>
      {children}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonVariants({ size: "sm" })}>{pending ? "Saving…" : submit}</button>
        {state && <p role="status" className={cn("text-xs", state.ok ? "text-gain" : "text-loss")}>{state.message}</p>}
      </div>
    </form>
  );
}
