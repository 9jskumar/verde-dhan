"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { Card } from "./ui";

/**
 * TradingView "Market Quotes" widget. TradingView has no data API, so this
 * renders TradingView's own prices inside the visitor's browser only. Its
 * numbers never reach the server, the scores, Claude's evidence or the
 * WhatsApp reports. Stock-index prices in TradingView widgets are delayed.
 */

export interface TvSymbol {
  /** TradingView symbol, e.g. "FX_IDC:USDINR". */
  name: string;
  displayName: string;
}

const SCRIPT = "https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js";

export function TradingViewQuotes({ title, symbols, height = 420 }: { title: string; symbols: TvSymbol[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.type = "text/javascript";
    s.innerHTML = JSON.stringify({
      width: "100%",
      height,
      symbolsGroups: [{ name: title, symbols }],
      showSymbolLogo: false,
      isTransparent: true,
      colorTheme: theme,
      locale: "en",
    });
    host.appendChild(s);
    return () => {
      host.innerHTML = "";
    };
  }, [title, symbols, height, theme]);

  return (
    <Card title={`${title} on TradingView`} subtitle="Shown in your browser only. Not used in scores or reports. Index prices are delayed.">
      <div className="tradingview-widget-container min-w-0" ref={ref} style={{ height }} />
      <p className="mt-2 text-xs text-text-3">
        Chart data by{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer nofollow" className="underline">
          TradingView
        </a>
      </p>
    </Card>
  );
}

/**
 * CFI Financial's CFD symbols on TradingView (each checked to load in a
 * widget). They match the CFI MT5 prices the bridge stores, but track the
 * cash index rather than being the official index level.
 */
export const TV_INDICES: TvSymbol[] = [
  { name: "CFI:US500", displayName: "S&P 500" },
  { name: "CFI:US100", displayName: "Nasdaq-100" },
  { name: "CFI:US30", displayName: "Dow Jones" },
  { name: "CFI:UK100", displayName: "FTSE 100" },
  { name: "CFI:GER30", displayName: "DAX 40" },
  { name: "CFI:JPN225", displayName: "Nikkei 225" },
];

export const TV_FOREX: TvSymbol[] = [
  { name: "FX_IDC:EURUSD", displayName: "EUR/USD" },
  { name: "FX_IDC:GBPUSD", displayName: "GBP/USD" },
  { name: "FX_IDC:USDJPY", displayName: "USD/JPY" },
  { name: "FX_IDC:USDINR", displayName: "USD/INR" },
  { name: "FX_IDC:EURINR", displayName: "EUR/INR" },
  { name: "FX_IDC:GBPINR", displayName: "GBP/INR" },
  { name: "FX_IDC:JPYINR", displayName: "JPY/INR" },
];

export const TV_COMMODITIES: TvSymbol[] = [
  { name: "CFI:BRENT", displayName: "Brent crude" },
  { name: "TVC:USOIL", displayName: "WTI crude" },
  { name: "TVC:GOLD", displayName: "Gold" },
  { name: "TVC:SILVER", displayName: "Silver" },
  { name: "NYMEX:NG1!", displayName: "Natural gas" },
  { name: "COMEX:HG1!", displayName: "Copper" },
];
