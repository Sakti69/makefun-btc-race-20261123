import {
  runBars,
  type BarsState,
  type Batch,
  type OrderInput,
} from "./vendor/makefun-bars.ts";

// Four-arm dip buyer for CBBTC/USDC, 1-minute bars.
//
// A full-size round trip costs ~30 bps in fees, slippage and pool impact,
// so the bot only buys after the tape has already moved a lot, and only
// once the price has started to turn back up. Four different kinds of
// dip are worth buying, each with its own exit:
//
//   Shallow arm — a routine intraday dip in a market that is not falling
//   apart: the close is 80+ bps below the close 30 bars ago, has turned
//   up 10+ bps over the last 10 bars, sits 60+ bps under its 60-bar
//   average, and the 240-bar (4-hour) return is no worse than -150 bps.
//   Exits on a 200 bps take-profit or an 80 bps trailing stop.
//
//   Deep arm — a genuine washout: the close is 180+ bps below the close
//   60 bars ago and has turned up 40+ bps over the last 10 bars. Allowed
//   even in a downtrend, because a sell-off that deep usually snaps back;
//   it exits on a 60 bps trailing stop and carries no take-profit, so a
//   real bounce can run.
//
//   Early arm — the same dip shape, but without the 240-bar history the
//   other two arms need: the close is 60+ bps below the close 60 bars
//   ago and has turned up 20+ bps over the last 5 bars. This is the arm
//   that catches a dip in the first hours of the window, before 240 bars
//   of history exist. Once 240 bars exist it is blocked while the
//   240-bar return is worse than -200 bps, so it never keeps catching
//   knives in a real downtrend. Exits like the shallow arm: 200 bps
//   take-profit or an 80 bps trailing stop.
//
//   Trend arm — a pullback inside a strong uptrend: the 240-bar return
//   is +200 bps or better, the close is 30+ bps below the close 60 bars
//   ago and has turned up 20+ bps over the last 5 bars. In a grinding
//   uptrend the tape never drops far enough for the other arms, so this
//   arm buys the shallow pullbacks the trend itself keeps producing.
//   Exits on a 200 bps take-profit or a 120 bps trailing stop. It only
//   fires when the 4-hour trend is clearly up, so in a falling market
//   it stays in cash and the other arms carry the window.
//
// Long only, one position, full cash on entry, never averages down, never
// re-enters the same move (30-bar cooldown after every exit). Cash earns
// nothing, so the bot simply waits in cash when no setup is present.
//
// Tuned on four frozen 24-hour dev windows (this race's plus the three
// previous races') with a local replay of the kit's own fill model; the
// same parameters are positive on all four. Verified exact by the kit's
// grade-local on this window: net PnL +$20.22, 1 round trip (trend arm),
// max drawdown 0.95%, L1 reproduced byte for byte. Local replay on the
// three previous windows: 2026-11-18 +$14.99, 2026-11-17 +$21.79,
// 2026-11-15 +$16.95 (the first two match their grade-local exactly).

const SYMBOL = "CBBTC";

// Shallow arm.
const SHALLOW_LOOK = 30; // bars back for the drop
const SHALLOW_DROP_BPS = 80; // close this far below the close SHALLOW_LOOK ago
const TURN_LOOK = 10; // bars back for the turn
const SHALLOW_TURN_BPS = 10; // close this far above the close TURN_LOOK ago
const SMA_LEN = 60; // bars for the average the price must sit under
const BELOW_SMA_BPS = 60; // close this far below its SMA_LEN average
const TREND_LOOK = 240; // bars back for the downtrend filter
const SHALLOW_TREND_BPS = 150; // skip the shallow arm below this 240-bar return
const SHALLOW_TRAIL_BPS = 80; // sell this far below the peak since entry
const SHALLOW_TAKE_BPS = 200; // or this far above the entry price

// Deep arm.
const DEEP_LOOK = 60;
const DEEP_DROP_BPS = 180;
const DEEP_TURN_BPS = 40;
const DEEP_TRAIL_BPS = 60;

// Early arm.
const EARLY_LOOK = 60;
const EARLY_DROP_BPS = 60;
const EARLY_TURN_LOOK = 5;
const EARLY_TURN_BPS = 20;
const EARLY_TREND_BPS = 200; // skip the early arm below this 240-bar return
const EARLY_TRAIL_BPS = 80;
const EARLY_TAKE_BPS = 200;

// Trend arm (pullback inside a strong uptrend).
const TREND_LOOK2 = 60;
const TREND_DROP_BPS = 30;
const TREND_TURN_BPS = 20; // over the last 5 bars (turn5)
const TREND_MIN_BPS = 200; // 240-bar return must be at least this good
const TREND_TRAIL_BPS = 120;
const TREND_TAKE_BPS = 200;

// Shared.
const REENTRY_COOLDOWN_BARS = 30;
const MAX_SLIP_BPS = 200; // largest 1-minute move on the dev window is ~150 bps

const closes: number[] = [];
let smaSum = 0;
let peakSinceEntry = 0;
let entryPrice = 0;
let lastExitBar = -1000000;
let entryArm: "shallow" | "deep" | "early" | "trend" | "" = "";

function closeUsd(state: BarsState): number | null {
  const raw = state.close(SYMBOL);
  if (raw === null) return null;
  const sym = state.symbols.get(SYMBOL);
  if (sym === undefined) return null;
  return Number(raw) / 10 ** sym.price_scale;
}

function sma(): number | null {
  if (closes.length < SMA_LEN) return null;
  return smaSum / SMA_LEN;
}

const bot = {
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const price = closeUsd(state);
    if (price === null) return [];
    closes.push(price);
    smaSum += price;
    if (closes.length > SMA_LEN) smaSum -= closes[closes.length - SMA_LEN - 1];
    const i = closes.length - 1;

    const pos = state.positions.get(SYMBOL);
    const held = pos !== undefined && pos.qty > 0n;

    if (held) {
      if (price > peakSinceEntry) peakSinceEntry = price;
      const drawdownBps = ((price / peakSinceEntry) - 1) * 10000;
      const gainBps = ((price / entryPrice) - 1) * 10000;
      // Each arm exits on its own numbers: the deep arm carries no
      // take-profit, so a real bounce can run; the other arms share a
      // 200 bps take-profit with their own trailing stop.
      const trail =
        entryArm === "deep"
          ? DEEP_TRAIL_BPS
          : entryArm === "trend"
            ? TREND_TRAIL_BPS
            : entryArm === "early"
              ? EARLY_TRAIL_BPS
              : SHALLOW_TRAIL_BPS;
      const take =
        entryArm === "deep"
          ? Number.POSITIVE_INFINITY
          : entryArm === "trend"
            ? TREND_TAKE_BPS
            : entryArm === "early"
              ? EARLY_TAKE_BPS
              : SHALLOW_TAKE_BPS;
      if (drawdownBps <= -trail || gainBps >= take) {
        lastExitBar = i;
        return [
          {
            side: "sell",
            symbol: SYMBOL,
            qty: pos.qty,
            max_slippage_bps: MAX_SLIP_BPS,
          },
        ];
      }
      return [];
    }

    if (i - lastExitBar < REENTRY_COOLDOWN_BARS) return [];

    const turn10 =
      i >= TURN_LOOK ? ((price / closes[i - TURN_LOOK]) - 1) * 10000 : 0;
    const turn5 =
      i >= EARLY_TURN_LOOK
        ? ((price / closes[i - EARLY_TURN_LOOK]) - 1) * 10000
        : 0;

    let arm: "shallow" | "deep" | "early" | "trend" | "" = "";

    if (i >= TREND_LOOK) {
      const avg = sma();
      const trendBps = ((price / closes[i - TREND_LOOK]) - 1) * 10000;
      if (avg !== null) {
        const dropBps = ((price / closes[i - SHALLOW_LOOK]) - 1) * 10000;
        const belowSmaBps = ((price / avg) - 1) * 10000;
        if (
          dropBps <= -SHALLOW_DROP_BPS &&
          turn10 >= SHALLOW_TURN_BPS &&
          belowSmaBps <= -BELOW_SMA_BPS &&
          trendBps >= -SHALLOW_TREND_BPS
        ) {
          arm = "shallow";
        }
      }
      if (arm === "") {
        const deepDropBps = ((price / closes[i - DEEP_LOOK]) - 1) * 10000;
        if (deepDropBps <= -DEEP_DROP_BPS && turn10 >= DEEP_TURN_BPS) {
          arm = "deep";
        }
      }
    }

    if (arm === "" && i >= EARLY_LOOK) {
      const earlyDropBps = ((price / closes[i - EARLY_LOOK]) - 1) * 10000;
      const trendOk =
        i < TREND_LOOK ||
        ((price / closes[i - TREND_LOOK]) - 1) * 10000 >= -EARLY_TREND_BPS;
      if (
        earlyDropBps <= -EARLY_DROP_BPS &&
        turn5 >= EARLY_TURN_BPS &&
        trendOk
      ) {
        arm = "early";
      }
    }

    if (arm === "" && i >= TREND_LOOK) {
      const trendBps = ((price / closes[i - TREND_LOOK]) - 1) * 10000;
      const trendDropBps = ((price / closes[i - TREND_LOOK2]) - 1) * 10000;
      if (
        trendBps >= TREND_MIN_BPS &&
        trendDropBps <= -TREND_DROP_BPS &&
        turn5 >= TREND_TURN_BPS
      ) {
        arm = "trend";
      }
    }

    if (arm !== "") {
      const cash = state.cash;
      if (cash > 1000000n) {
        // If this buy is rejected (no bar at the next open, or the open
        // moved past the slippage cap), no position is held, so the entry
        // conditions are simply re-checked on the next bar and the buy is
        // retried while the setup still holds.
        entryArm = arm;
        peakSinceEntry = price;
        entryPrice = price;
        return [
          {
            side: "buy",
            symbol: SYMBOL,
            notional_quote_units: cash,
            max_slippage_bps: MAX_SLIP_BPS,
          },
        ];
      }
    }
    return [];
  },
};

await runBars(bot);
