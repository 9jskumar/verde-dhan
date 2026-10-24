import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/** shadcn/ui-style primitives, styled with the Verde Dhan tokens. */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Card({ className, children, title, action, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-line bg-panel", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-text">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-text-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export const badgeVariants = cva("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-panel-2 text-text-2",
      gain: "bg-gain-soft text-gain",
      loss: "bg-loss-soft text-loss",
      warn: "bg-warn-soft text-warn",
      info: "bg-info-soft text-info",
      accent: "bg-accent-soft text-accent",
      demo: "bg-demo-soft text-demo",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ tone, className, children }: VariantProps<typeof badgeVariants> & { className?: string; children: ReactNode }) {
  return <span className={cn(badgeVariants({ tone }), className)}>{children}</span>;
}

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:opacity-90 dark:text-bg",
        secondary: "border border-line bg-panel text-text hover:bg-panel-2",
        ghost: "text-text-2 hover:bg-panel-2 hover:text-text",
      },
      size: { sm: "h-8 px-3", md: "h-9 px-4", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Change({ value, suffix = "%", className }: { value: number | null | undefined; suffix?: string; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cn("num text-text-3", className)}>n/a</span>;
  const tone = value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-text-2";
  return (
    <span className={cn("num", tone, className)}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {Math.abs(value).toFixed(2)}
      {suffix}
    </span>
  );
}

export function fmt(value: number | null | undefined, dp = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function Num({ value, dp = 2, className }: { value: number | null | undefined; dp?: number; className?: string }) {
  return <span className={cn("num", value === null || value === undefined ? "text-text-3" : "", className)}>{fmt(value, dp)}</span>;
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-text-2">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-lg text-sm text-text-2">{children}</div>}
    </div>
  );
}

export function PendingIntegration({ feature, needs }: { feature: string; needs: string[] }) {
  return (
    <div className="rounded-md border border-warn/40 bg-warn-soft px-4 py-3 text-sm">
      <p className="font-medium text-warn">{feature}: pending integration</p>
      <p className="mt-1 text-text-2">
        No data is shown because the provider is not configured. Set <span className="num text-xs">{needs.join(", ")}</span> on the server. See ENVIRONMENT_VARIABLES.md.
      </p>
    </div>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("-mx-4 overflow-x-auto", className)}>
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-text-3">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-4 py-2 font-medium first:pl-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-2 align-middle", className)}>{children}</td>;
}

export function SourceNote({ source, asOf, isDemo, delaySeconds }: { source: string; asOf?: string | null; isDemo?: boolean; delaySeconds?: number }) {
  return (
    <p className="mt-2 text-[11px] text-text-3">
      Source: {isDemo ? <span className="text-demo">synthetic demo generator</span> : source}
      {asOf ? ` · as of ${asOf.replace("T", " ").slice(0, 16)}` : ""}
      {delaySeconds ? ` · delayed ${Math.round(delaySeconds / 60)} min` : ""}
    </p>
  );
}
