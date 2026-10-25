"""Unit tests for the CFI MT5 bridge helpers. Run: python bridge/cfi_mt5/test_bridge.py"""
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
import cfi_mt5_bridge as b  # noqa: E402


class BridgeTests(unittest.TestCase):
    def test_offset_inferred_from_freshest_tick(self):
        now = 1_800_000_000.0
        self.assertEqual(b.server_offset_hours([int(now + 3 * 3600 - 40), int(now - 5000)], now, None), 3.0)
        self.assertEqual(b.server_offset_hours([], now, "2"), 2.0)
        with self.assertRaises(SystemExit):
            b.server_offset_hours([], now, None)

    def test_rows_are_labelled_and_changes_computed(self):
        now = datetime(2026, 10, 26, 2, 0, tzinfo=timezone.utc)
        readings = [
            b.Reading("SPX", "US500", now - timedelta(minutes=1), 7633.0, 7600.0, 7650.0, 7590.0),
            b.Reading("BRENT", "BRENT", now - timedelta(hours=30), 111.94, 110.0, 112.5, 109.8),
        ]
        idx, cmd = b.build_rows(readings, now)
        self.assertEqual(idx[0]["source"], "cfi")
        self.assertEqual(idx[0]["currency"], "USD")
        self.assertAlmostEqual(idx[0]["percentage_change"], 0.4342, places=4)
        self.assertEqual(idx[0]["market_status"], "OPEN")
        self.assertEqual(cmd[0]["contract_type"], "CONTINUOUS_FUTURE")
        self.assertEqual(cmd[0]["unit"], "bbl")
        self.assertIsNone(cmd[0]["contract_month"])

    def test_closed_market_and_missing_previous_close(self):
        now = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
        idx, _ = b.build_rows([b.Reading("N225", "JPN225", now - timedelta(days=1), 62518.0, None, None, None)], now)
        self.assertEqual(idx[0]["market_status"], "CLOSED")
        self.assertIsNone(idx[0]["percentage_change"])
        self.assertIsNone(idx[0]["absolute_change"])

    def test_symbol_map_rejects_unknown_keys_and_requires_config(self):
        os.environ.pop("CFI_SYMBOL_MAP", None)
        with self.assertRaises(SystemExit):
            b.symbol_map()
        os.environ["CFI_SYMBOL_MAP"] = '{"SPX":"US500","FOO":"X"}'
        with self.assertRaises(SystemExit):
            b.symbol_map()
        os.environ["CFI_SYMBOL_MAP"] = '{"SPX":"US500","BRENT":"BRENT"}'
        self.assertEqual(b.symbol_map(), {"SPX": "US500", "BRENT": "BRENT"})


if __name__ == "__main__":
    unittest.main()
