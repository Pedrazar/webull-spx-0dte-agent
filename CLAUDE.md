# SPX 0DTE Call Agent

Port of `../webull-spy-0dte-agent` (its CLAUDE.md covers the settle/retry design and the SPY-era incident fixes; they apply here unchanged). Same paper account, same Webull OpenAPI sandbox, same `webullClient.ts`/`optionsClient.ts`/`marketHours.ts`. Each agent only matches its own symbol.

## Strategy

- **10:30am ET**: buy `SPX_CONTRACTS` (1) of the **SPXW CALL expiring today** nearest to `level - SPX_STRIKE_OFFSET` (10 points, the SPY $1 equivalent; strikes are 5 apart). LIMIT, repriced up from the ask via `escalatingDiscount()` (3/6/12/24/48%), 10s per attempt. No entry after 11:00am.
- **Stop**: client-side, exit if mid <= 75% of entry (`SPX_STOP_LOSS_PCT=0.25`), polled every 15s. Gaps through the level are normal (fills land at -25% to -29%, and -63% once).
- **Trailing stop**: once mid >= 1.5x entry (`SPX_TRAIL_ARM`), also exit if mid falls 20% below its high-water mark (`SPX_TRAIL_PCT=0.20`, 0 disables). First trail level is 1.2x entry, so an armed trail exit is always a profit. Peak ignores quotes with >10% spreads. Logged as reason `trailing_stop`.
- **EOD**: close at 3:45pm ET (12:45pm half-days); LIMIT sells repriced down from the bid until 1 min before close.

Settings live in `.github/workflows/spx-0dte.yml` (what Actions uses), `.env`, and `main.ts` defaults; keep all three in sync.

## SPX-specific facts (live-verified)

- **Root is SPXW** (PM-settled dailies). A chain query with `underlying_symbols=SPX` returns both roots; on third Fridays the AM-settled `SPX` monthly shares the date, so `enter()` filters `root_symbol === "SPXW"`.
- **Order leg `symbol` must be `SPXW`**, not `SPX` (OPENAPI_PARAM_ERR). Position `symbol` is accepted as either in `findHeldCall()`.
- **No index quote.** `fetchSpxPrice()` derives the level from put-call parity (median of `K + Cmid - Pmid` over 9 strikes around SPY x 10.06; SPY x 10 alone is ~45 pts off). Returns null (entry skipped, `no_price`) if <3 strikes have quotes or it disagrees with SPY by >1.5%.
- **Tick size**: $0.05 under $3, $0.10 above; `snapToTick()` rounds buys up and sells down.
- **Cash-settled, European**: no share assignment; a stranded position just settles at intrinsic. Premium is ~10x SPY's (~$1,700-3,700 per contract), so dollar P&L is ~10x.
- Quotes were 15 min delayed at first; recent sessions report `delay_minutes: 0`.
- Broker position lookups (`findHeldCall()`) retry 6x with backoff; a post-exit failure logs `exit_failed`, never a false "closed" (added after a 429 crashed the SPY live agent).

## Hosting

Public repo `Pedrazar/webull-spx-0dte-agent`; 4 repo secrets (`WEBULL_APP_KEY`, `WEBULL_APP_SECRET`, `WEBULL_BASE_URL`, `WEBULL_SANDBOX_ACCOUNT_ID`); cron-job.org dispatches `spx-0dte.yml` at `20 7 * * 1-5` America/Los_Angeles (10:20am ET year-round). Don't dispatch before 10:10am ET (`main.ts` refuses; the session must fit the 6h runner cap). Trade log `spx-trades.jsonl` and `spx-state.json` are committed back by the workflow.

## Files

`main.ts` (session), `tradeLogger.ts`, `testSpxChain.ts [YYYY-MM-DD]` (live check + BUY_TO_OPEN preview, never orders).

## Known behavior / open items

- **Unfilled entry (2026-11-05)**: SPX ripped, the call's ask went 36.6 -> 46.7 in 45s, and every repriced buy (+3% ... +24% over a stale ask) was cancelled; logged `order_not_filled`, no position. Not changed. A more aggressive first step would fix it at the cost of overpaying on normal days.
- Holding to the close usually loses on stop/trail days (calls fade or expire worthless); the 10-21 run-to-close day is the exception. Reviews compare each exit against the contract's 4pm last price via a snapshot.

## History

- 2026-10-16 built; 10-19 first live run (-50% stop). 10-20 stop 50% -> 25% after a -$1,250 (-63%) gap-through. 10-21 trailing stop added (25%), 10-21 width changed to 20%. 10-19 position-lookup retry added.
