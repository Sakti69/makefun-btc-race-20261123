# makefun-btc-race-20261123

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Sakti69/makefun-btc-race-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Sakti69/makefun-btc-race-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Four-Arm Dip Buyer — a long-only bot trading cbBTC/USDC on 1-minute bars. It buys shallow pullbacks in uptrends and sharp dips after washouts, with take-profit and trailing-stop exits; dev-window net PnL +$20.22 on $1,000 paper money.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=5sh8pzmc&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>

# Four-Arm Dip Buyer — BTC trading bot (make.fun btc-race-24h-20261123-0511)

Long-only bot trading CBBTC/USDC on 1-minute bars.

## Strategy

A full-size round trip costs ~30 bps in fees, slippage and pool impact, so
the bot only trades when the tape has already moved a lot and started to
turn back up. Four setups:

1. **Shallow arm** — routine intraday dip: close 80+ bps below the close
   30 bars ago, turned up 10+ bps over the last 10 bars, 60+ bps under its
   60-bar average, and the 4-hour return is no worse than -150 bps (never
   catches a falling knife in a real downtrend). Exit: 200 bps take-profit
   or 80 bps trailing stop.
2. **Deep arm** — genuine washout: close 180+ bps below the close 60 bars
   ago, turned up 40+ bps over the last 10 bars. Allowed even in a
   downtrend. Exit: 60 bps trailing stop, no take-profit.
3. **Early arm** — the same dip shape without the 240-bar history the other
   arms need: close 60+ bps below the close 60 bars ago, turned up 20+ bps
   over the last 5 bars. Catches a dip in the first hours of the window;
   once 240 bars exist it is blocked while the 4-hour return is worse than
   -200 bps. Exit: 200 bps take-profit or 80 bps trailing stop.
4. **Trend arm** — a pullback inside a strong uptrend: 240-bar return
   +200 bps or better, close 30+ bps below the close 60 bars ago, turned
   up 20+ bps over the last 5 bars. In a grinding uptrend the tape never
   drops far enough for the other arms, so this arm buys the shallow
   pullbacks the trend itself keeps producing. Exit: 200 bps take-profit
   or 120 bps trailing stop.

One position at a time, full cash on entry, no averaging down, 30-bar
cooldown after every exit. Otherwise the bot waits in cash.

## Local dev-window result

Graded on the kit's dev window (2026-11-22 05:11 UTC → 2026-11-23 05:11 UTC,
BTC +3.64% over the window) with the kit's own grader
(`grade-local --driver process`):

- Net PnL **+$20.22** on $1,000 start (buy-and-hold: ~+$32 before the
  identical-behaviour rule; this bot is not buy-and-hold)
- 2 trades (1 round trip, trend arm: buy bar 265 at $60,105, sell bar 424
  at $61,370), max drawdown 0.95%, L1 regrade reproduced byte for byte
- Passes the dev gate (net PnL > 0) and the guardrails (≥1 trade, max
  drawdown ≤ 25%)

Same parameters, same local replay model, on the three previous races' dev
windows: +$14.99 (2026-11-18, BTC -2.80%), +$21.79 (2026-11-17,
BTC +0.49%), +$16.95 (2026-11-15, BTC -4.00%) — positive on all four
windows, including both falling ones.

## Files

- `main.ts` — the bot (Node 22, TypeScript, erasable syntax)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim
- `LICENSE` — MIT
