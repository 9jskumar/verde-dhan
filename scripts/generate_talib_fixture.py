"""Generate TA-Lib reference values for the indicator test-suite.

The OHLCV series is a seeded synthetic random walk (test input only, never
shown to users). TA-Lib is the trusted reference implementation.

    python -m venv .venv && .venv/bin/pip install ta-lib numpy
    .venv/bin/python scripts/generate_talib_fixture.py
"""
import json
import pathlib

import numpy as np
import talib

rng = np.random.default_rng(20261024)
n = 320
close = 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.015, n)))
open_ = close * (1 + rng.normal(0, 0.004, n))
high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.006, n)))
low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.006, n)))
volume = rng.integers(200_000, 2_000_000, n).astype(float)


def clean(arr):
    return [None if np.isnan(v) else float(v) for v in arr]


macd, signal, hist = talib.MACD(close, 12, 26, 9)
upper, middle, lower = talib.BBANDS(close, 20, 2, 2, 0)
out = {
    "generator": f"TA-Lib {talib.__version__}",
    "bars": [
        {"open": float(o), "high": float(h), "low": float(l), "close": float(c), "volume": float(v)}
        for o, h, l, c, v in zip(open_, high, low, close, volume)
    ],
    "sma20": clean(talib.SMA(close, 20)),
    "ema20": clean(talib.EMA(close, 20)),
    "ema50": clean(talib.EMA(close, 50)),
    "rsi14": clean(talib.RSI(close, 14)),
    "atr14": clean(talib.ATR(high, low, close, 14)),
    "adx14": clean(talib.ADX(high, low, close, 14)),
    "plusDI14": clean(talib.PLUS_DI(high, low, close, 14)),
    "minusDI14": clean(talib.MINUS_DI(high, low, close, 14)),
    "macd": clean(macd),
    "macdSignal": clean(signal),
    "macdHist": clean(hist),
    "bbUpper": clean(upper),
    "bbMiddle": clean(middle),
    "bbLower": clean(lower),
}
path = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "talib_reference.json"
path.write_text(json.dumps(out))
print(f"wrote {path} ({n} bars)")
