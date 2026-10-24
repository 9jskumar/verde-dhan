export interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: "Markets" | "Research" | "Opportunities" | "My account" | "System";
}

/** The 21 sections from the product brief, grouped for the sidebar. */
export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard", group: "Markets" },
  { href: "/india", label: "Indian Markets", icon: "Landmark", group: "Markets" },
  { href: "/global", label: "Global Markets", icon: "Globe", group: "Markets" },
  { href: "/forex", label: "Forex", icon: "Coins", group: "Markets" },
  { href: "/commodities", label: "Commodities", icon: "Fuel", group: "Markets" },
  { href: "/screener", label: "Stock Screener", icon: "Funnel", group: "Research" },
  { href: "/breakouts", label: "Breakout Scanner", icon: "Zap", group: "Research" },
  { href: "/fundamentals", label: "Fundamental Analysis", icon: "ChartColumn", group: "Research" },
  { href: "/technicals", label: "Technical Analysis", icon: "ChartCandlestick", group: "Research" },
  { href: "/top-10", label: "Top 10 Opportunities", icon: "Trophy", group: "Opportunities" },
  { href: "/top-3", label: "Top 3 Opportunities", icon: "Medal", group: "Opportunities" },
  { href: "/sectors", label: "Sector Intelligence", icon: "Factory", group: "Opportunities" },
  { href: "/news", label: "News & Trends", icon: "Newspaper", group: "Opportunities" },
  { href: "/watchlist", label: "Watchlist", icon: "Star", group: "My account" },
  { href: "/portfolio", label: "Portfolio", icon: "Briefcase", group: "My account" },
  { href: "/risk", label: "Risk Calculator", icon: "Calculator", group: "My account" },
  { href: "/performance", label: "Performance Analytics", icon: "ChartLine", group: "My account" },
  { href: "/assistant", label: "AI Research Assistant", icon: "Bot", group: "My account" },
  { href: "/notifications", label: "Notifications", icon: "Bell", group: "System" },
  { href: "/settings", label: "Settings", icon: "Settings", group: "System" },
  { href: "/admin", label: "Administration", icon: "ShieldCheck", group: "System" },
];
