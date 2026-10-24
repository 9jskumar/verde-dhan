/**
 * Exchange calendar helpers. Holidays are NOT hard-coded: they are loaded
 * from the `market_holidays` table, which an admin populates from the
 * official NSE/BSE holiday circulars each year. When the table has no rows
 * for the current year, jobs record a data-quality warning.
 */

export const IST = "Asia/Kolkata";

/** Calendar date (YYYY-MM-DD) of `d` in the given IANA timezone. */
export function localDate(d: Date, timeZone = IST): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function localMinutes(d: Date, timeZone = IST): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

export function localWeekday(d: Date, timeZone = IST): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

export function isIndianTradingDay(d: Date, holidays: ReadonlySet<string>): boolean {
  const wd = localWeekday(d);
  return wd >= 1 && wd <= 5 && !holidays.has(localDate(d));
}

export type IndianSession = "PRE_OPEN" | "OPEN" | "POST_CLOSE" | "CLOSED";

/** NSE/BSE equity cash market: pre-open 09:00–09:15, normal 09:15–15:30 IST. */
export function indianSession(d: Date, holidays: ReadonlySet<string>): IndianSession {
  if (!isIndianTradingDay(d, holidays)) return "CLOSED";
  const m = localMinutes(d);
  if (m >= 9 * 60 && m < 9 * 60 + 15) return "PRE_OPEN";
  if (m >= 9 * 60 + 15 && m < 15 * 60 + 30) return "OPEN";
  if (m >= 15 * 60 + 30 && m < 18 * 60) return "POST_CLOSE";
  return "CLOSED";
}

/** Most recent trading day on or before `d` (IST), skipping weekends and holidays. */
export function previousTradingDay(d: Date, holidays: ReadonlySet<string>): string {
  const probe = new Date(d.getTime());
  for (let i = 0; i < 15; i++) {
    if (isIndianTradingDay(probe, holidays)) return localDate(probe);
    probe.setUTCDate(probe.getUTCDate() - 1);
  }
  throw new Error("no trading day found in the last 15 days; check market_holidays");
}
