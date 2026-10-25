"""
Verde Dhan: CFI Financial (MetaTrader 5) price bridge.

CFI Financial provides prices through its MetaTrader 5 platform. The only
official way for a program to read MT5 prices is MetaQuotes' `MetaTrader5`
Python package, which talks to an MT5 terminal running on the same Windows
machine. This script reads the latest tick and daily bars for the
configured CFI symbols and writes them to Supabase, where the web app,
global impact engine, Claude evidence and WhatsApp reports pick them up.

What it writes (source = "cfi"):
  - global_indices   for SPX, NDX, DJI, FTSE, DAX, N225
  - commodity_prices for BRENT (and any other commodity key you map)

The prices are CFI's CFD quotes. They track the underlying index or
futures market but are not the official index level or exchange
settlement, and every row says so through its source.

Usage (Windows, with the CFI MT5 terminal installed):
  pip install -r requirements.txt
  python cfi_mt5_bridge.py --env-file ..\\..\\.env.local --list-symbols   # see CFI's symbol names
  python cfi_mt5_bridge.py --env-file ..\\..\\.env.local --dry-run        # read prices, write nothing
  python cfi_mt5_bridge.py --env-file ..\\..\\.env.local                  # read and store

Use the MT5 *investor* (read-only) password: it can read prices but cannot
place trades. Credentials are only read from the environment or env file
and are never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

SOURCE = "cfi"

# Internal key -> (asset class, currency, unit, country). Currencies follow
# the underlying market; check them against the CFI contract specification.
INSTRUMENTS: dict[str, tuple[str, str, str | None, str]] = {
    "SPX": ("INDEX", "USD", None, "US"),
    "NDX": ("INDEX", "USD", None, "US"),
    "DJI": ("INDEX", "USD", None, "US"),
    "FTSE": ("INDEX", "GBP", None, "GB"),
    "DAX": ("INDEX", "EUR", None, "DE"),
    "N225": ("INDEX", "JPY", None, "JP"),
    "BRENT": ("COMMODITY", "USD", "bbl", "XX"),
    "WTI": ("COMMODITY", "USD", "bbl", "US"),
    "XAU": ("COMMODITY", "USD", "troy oz", "XX"),
    "XAG": ("COMMODITY", "USD", "troy oz", "XX"),
}

NAMES = {
    "SPX": "S&P 500", "NDX": "Nasdaq-100", "DJI": "Dow Jones", "FTSE": "FTSE 100",
    "DAX": "DAX", "N225": "Nikkei 225",
}

# A quote older than this is treated as a closed market, not a live price.
STALE_AFTER = timedelta(minutes=20)


@dataclass
class Reading:
    key: str
    cfi_symbol: str
    timestamp: datetime  # UTC
    last: float
    previous_close: float | None
    day_high: float | None
    day_low: float | None


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def load_env_file(path: str) -> None:
    """Loads KEY=VALUE lines into os.environ without overriding existing values."""
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            os.environ.setdefault(k, v)


def symbol_map() -> dict[str, str]:
    raw = os.environ.get("CFI_SYMBOL_MAP", "").strip()
    if not raw:
        raise SystemExit("CFI_SYMBOL_MAP is not set. Run with --list-symbols, then map keys to CFI symbols, "
                         'e.g. {"SPX":"US500","BRENT":"UKOIL"}. Symbols are never guessed.')
    try:
        m = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"CFI_SYMBOL_MAP is not valid JSON: {exc.msg}") from None
    unknown = sorted(set(m) - set(INSTRUMENTS))
    if unknown:
        raise SystemExit(f"CFI_SYMBOL_MAP has unsupported keys: {', '.join(unknown)}")
    return {k: str(v) for k, v in m.items() if v}


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested without MT5)
# ---------------------------------------------------------------------------

def server_offset_hours(tick_epochs: list[int], now_utc: float, configured: str | None) -> float:
    """
    MT5 reports times in the trade server's clock as if it were UTC. CFI's
    server runs ahead of UTC (it changes with daylight saving), so the
    offset is taken from CFI_SERVER_UTC_OFFSET when set, otherwise inferred
    from the freshest tick, rounded to the nearest half hour.
    """
    if configured not in (None, ""):
        return float(configured)
    if not tick_epochs:
        raise SystemExit("cannot infer the MT5 server clock offset (no ticks); set CFI_SERVER_UTC_OFFSET")
    diff_h = (max(tick_epochs) - now_utc) / 3600
    return round(diff_h * 2) / 2


def to_utc(server_epoch: int, offset_h: float) -> datetime:
    return datetime.fromtimestamp(server_epoch - offset_h * 3600, tz=timezone.utc)


def market_status(ts: datetime, now: datetime) -> str:
    return "OPEN" if now - ts <= STALE_AFTER else "CLOSED"


def pct(last: float, prev: float | None) -> float | None:
    return None if not prev else round((last - prev) / prev * 100, 4)


def build_rows(readings: list[Reading], now: datetime) -> tuple[list[dict], list[dict]]:
    indices: list[dict] = []
    commodities: list[dict] = []
    for r in readings:
        asset, ccy, unit, country = INSTRUMENTS[r.key]
        if r.last <= 0:
            continue
        base = {"timestamp": r.timestamp.isoformat(), "source": SOURCE, "data_delay_seconds": 0}
        if asset == "INDEX":
            indices.append({
                **base,
                "symbol": r.key, "name": NAMES.get(r.key, r.key), "country": country, "currency": ccy,
                "last_value": r.last, "previous_close": r.previous_close,
                "absolute_change": None if r.previous_close is None else round(r.last - r.previous_close, 4),
                "percentage_change": pct(r.last, r.previous_close),
                "day_high": r.day_high, "day_low": r.day_low,
                "market_status": market_status(r.timestamp, now),
            })
        else:
            commodities.append({
                **base,
                "instrument": r.key, "price": r.last, "currency": ccy, "unit": unit,
                # A CFD on the rolling futures contract.
                "contract_type": "CONTINUOUS_FUTURE", "contract_month": None,
                "previous_close": r.previous_close, "percentage_change": pct(r.last, r.previous_close),
            })
    return indices, commodities


# ---------------------------------------------------------------------------
# MT5
# ---------------------------------------------------------------------------

def connect():
    try:
        import MetaTrader5 as mt5  # type: ignore[import-not-found]
    except ImportError:
        raise SystemExit("The MetaTrader5 package is not installed (pip install -r requirements.txt). It runs on Windows only.") from None
    kwargs = {}
    if os.environ.get("CFI_MT5_TERMINAL_PATH"):
        kwargs["path"] = os.environ["CFI_MT5_TERMINAL_PATH"]
    login = os.environ.get("CFI_MT5_LOGIN")
    if login:
        kwargs.update(login=int(login), password=os.environ.get("CFI_MT5_PASSWORD", ""), server=os.environ.get("CFI_MT5_SERVER", ""))
    if not mt5.initialize(**kwargs):
        code, _msg = mt5.last_error()
        raise SystemExit(f"could not connect to the CFI MT5 terminal (error {code}). Is it installed and logged in?")
    return mt5


def read_prices(mt5, mapping: dict[str, str]) -> tuple[list[tuple[str, str, object, object]], list[str]]:
    raw = []
    problems = []
    for key, sym in mapping.items():
        if not mt5.symbol_select(sym, True):
            problems.append(f"{key}: CFI symbol {sym!r} not found")
            continue
        tick = mt5.symbol_info_tick(sym)
        rates = mt5.copy_rates_from_pos(sym, mt5.TIMEFRAME_D1, 0, 2)
        if tick is None or rates is None or len(rates) < 2:
            problems.append(f"{key}: no price data for {sym!r}")
            continue
        raw.append((key, sym, tick, rates))
    return raw, problems


def to_readings(raw, offset_h: float) -> list[Reading]:
    out = []
    for key, sym, tick, rates in raw:
        last = float(tick.last) if getattr(tick, "last", 0) else (float(tick.bid) + float(tick.ask)) / 2
        prev_bar, today_bar = rates[0], rates[1]
        out.append(Reading(
            key=key, cfi_symbol=sym,
            timestamp=to_utc(int(tick.time), offset_h),
            last=last,
            # Previous close of CFI's trading day (server time), not the exchange's official close.
            previous_close=float(prev_bar["close"]) or None,
            day_high=float(today_bar["high"]) or None,
            day_low=float(today_bar["low"]) or None,
        ))
    return out


# ---------------------------------------------------------------------------
# Supabase (PostgREST) writes with the service-role key
# ---------------------------------------------------------------------------

def post(table: str, rows: list[dict], on_conflict: str) -> None:
    if not rows:
        return
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SystemExit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}?on_conflict={on_conflict}",
        data=json.dumps(rows).encode(),
        method="POST",
        headers={
            "apikey": key,
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20):
            pass
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise SystemExit(f"{table}: Supabase returned HTTP {exc.code}: {detail}") from None


def provider_health(ok: bool, error: str | None) -> None:
    now = datetime.now(timezone.utc).isoformat()
    row = {"provider": SOURCE, "capability": "global_indices", "consecutive_failures": 0 if ok else 1, "circuit_state": "CLOSED"}
    row.update({"last_success_at": now} if ok else {"last_failure_at": now, "last_error": (error or "")[:500]})
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    req = urllib.request.Request(
        f"{url}/rest/v1/provider_health?on_conflict=provider,capability",
        data=json.dumps([row]).encode(), method="POST",
        headers={"apikey": key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20):
            pass
    except urllib.error.URLError:
        pass  # health is best-effort


# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", help="KEY=VALUE file such as .env.local")
    ap.add_argument("--list-symbols", action="store_true", help="print CFI symbols matching common index and oil names, then exit")
    ap.add_argument("--dry-run", action="store_true", help="read prices and print them; write nothing")
    ap.add_argument("--loop", type=int, metavar="SECONDS", help="repeat every SECONDS (otherwise run once)")
    args = ap.parse_args(argv)
    if args.env_file:
        load_env_file(args.env_file)

    mt5 = connect()
    try:
        if args.list_symbols:
            words = ("US", "500", "100", "30", "NAS", "DOW", "UK", "FTSE", "GER", "DE", "DAX", "JP", "JPN", "NIK", "225", "OIL", "BRENT", "WTI", "XAU", "XAG")
            for s in mt5.symbols_get() or []:
                if any(w in s.name.upper() for w in words):
                    print(f"{s.name:<16} {s.description}")
            return 0

        mapping = symbol_map()
        while True:
            raw, problems = read_prices(mt5, mapping)
            offset = server_offset_hours([int(t.time) for _, _, t, _ in raw], time.time(), os.environ.get("CFI_SERVER_UTC_OFFSET"))
            readings = to_readings(raw, offset)
            now = datetime.now(timezone.utc)
            indices, commodities = build_rows(readings, now)
            for p in problems:
                print(f"warning: {p}", file=sys.stderr)
            if args.dry_run:
                print(f"server clock offset: UTC{offset:+g} h")
                for r in readings:
                    print(f"{r.key:<6} {r.cfi_symbol:<12} {r.last:>14,.2f}  prev {r.previous_close}  at {r.timestamp.isoformat()}  ({market_status(r.timestamp, now)})")
            else:
                post("global_indices", indices, "symbol,timestamp,source")
                post("commodity_prices", commodities, "instrument,timestamp,source,contract_type")
                provider_health(not problems, "; ".join(problems) or None)
                print(f"stored {len(indices)} index and {len(commodities)} commodity readings from CFI")
            if not args.loop:
                return 1 if problems and not readings else 0
            time.sleep(max(30, args.loop))
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main())
