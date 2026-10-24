"use client";
import {
  Bell, Bot, Briefcase, Calculator, ChartCandlestick, ChartColumn, ChartLine, Coins, Factory, Fuel, Funnel, Globe, Landmark,
  LayoutDashboard, Medal, Menu, Moon, Newspaper, Settings, ShieldCheck, Star, Sun, Trophy, X, Zap, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import { NAV } from "@/lib/nav";
import { cn } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Landmark, Globe, Coins, Fuel, Funnel, Zap, ChartColumn, ChartCandlestick, Trophy, Medal, Factory, Newspaper,
  Star, Briefcase, Calculator, ChartLine, Bot, Bell, Settings, ShieldCheck,
};

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-2 hover:bg-panel-2 hover:text-text"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <nav aria-label="Main" className="space-y-5">
      {groups.map((g) => (
        <div key={g}>
          <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-3">{g}</p>
          <ul>
            {NAV.filter((n) => n.group === g).map((n) => {
              const Icon = ICONS[n.icon] ?? LayoutDashboard;
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm",
                      active ? "bg-accent-soft font-medium text-text" : "text-text-2 hover:bg-panel-2 hover:text-text",
                    )}
                  >
                    <Icon size={15} className={active ? "text-accent" : ""} aria-hidden />
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children, mode, userEmail }: { children: ReactNode; mode: "live" | "demo" | "unconfigured"; userEmail: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh">
      {mode === "demo" && (
        <div role="status" className="sticky top-0 z-40 bg-demo px-4 py-1.5 text-center text-xs font-medium text-white dark:text-bg">
          DEMO MODE: all prices, indices and companies on this site are synthetic and fictional. Nothing here is market data.
        </div>
      )}
      {mode === "unconfigured" && (
        <div role="status" className="bg-warn-soft px-4 py-1.5 text-center text-xs text-warn">
          No data providers are configured yet. Pages show which integrations are pending.
        </div>
      )}
      <div className="flex">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-r border-line bg-panel px-2 py-4 lg:block">
          <Brand />
          <div className="mt-5">
            <NavList />
          </div>
        </aside>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-panel px-2 py-4">
              <div className="flex items-center justify-between pr-2">
                <Brand />
                <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-text-2 hover:bg-panel-2" aria-label="Close navigation">
                  <X size={18} />
                </button>
              </div>
              <div className="mt-5">
                <NavList onNavigate={() => setOpen(false)} />
              </div>
            </div>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-bg/90 px-4 backdrop-blur">
            <button type="button" className="rounded-md p-2 text-text-2 hover:bg-panel-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
              <Menu size={18} />
            </button>
            <div className="lg:hidden">
              <Brand compact />
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-text-3">
              {userEmail ? (
                <>
                  <span className="hidden sm:inline">{userEmail}</span>
                  <form action="/auth/signout" method="post">
                    <button className="rounded-md px-2 py-1 hover:bg-panel-2 hover:text-text" type="submit">
                      Sign out
                    </button>
                  </form>
                </>
              ) : mode === "live" ? (
                <Link className="rounded-md px-2 py-1 hover:bg-panel-2 hover:text-text" href="/login">
                  Sign in
                </Link>
              ) : null}
              <ThemeToggle />
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-7xl px-4 pb-8 text-[11px] leading-5 text-text-3">
            Verde Dhan is a research tool. It does not place trades and nothing here is personalised investment advice. Scores and levels come from documented
            rules applied to sourced data; AI text explains those results and is checked against them. Markets carry risk, including loss of capital.
          </footer>
        </div>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2 px-3">
      <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded bg-brand text-[11px] font-bold text-white dark:text-bg">
        VD
      </span>
      {!compact && <span className="text-sm font-semibold tracking-tight">Verde Dhan</span>}
    </Link>
  );
}
