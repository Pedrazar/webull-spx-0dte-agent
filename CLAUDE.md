# SPX 0DTE Call Agent

Port of `../webull-spy-0dte-agent` (read its CLAUDE.md first: strategy,
settle/retry design, 2026-09-28 crash fix, 2026-10-02 repricing fix, hosting
via cron-job.org + GitHub Actions all apply unchanged). Same account, same
Webull OpenAPI sandbox, same `webullClient.ts`/`optionsClient.ts`/`marketHours.ts`.

## Strategy (same criteria as SPY)

- **10:30am ET**: buy `SPX_CONTRACTS` (1) of the **SPXW CALL expiring today**
  nearest to `level - SPX_STRIKE_OFFSET` (**10 points**, the SPY $1 equivalent
  since SPX ~ 10x SPY; strikes are 5 apart). LIMIT, repriced up from the ask
  via `escalatingDiscount()`, no entry after 11:00am.
- **Stop**: client-side, mid <= 50% of entry, polled every 15s.
- **EOD**: close at 3:45pm ET (12:45pm on half-days); exits are LIMIT sells
  repriced down from the bid until 1 min before close.

## SPX-specific differences (live-verified 2026-10-16)

- **Root is SPXW.** Daily 0DTE contracts are `SPXW` (PM-settled). A chain query
  with `underlying_symbols=SPX` returns both roots. On third Fridays (e.g.
  2026-10-16) the AM-settled `SPX` monthly shares the date, so `enter()`
  filters `root_symbol === "SPXW"`. Never trade the AM-settled root.
- **Order leg `symbol` must be `SPXW`**, not `SPX` (preview rejects `SPX` with
  OPENAPI_PARAM_ERR). `optionSymbol` is OCC, e.g. `SPXW261019C07650000`.
- **No index quote.** Stock bars reject `SPX`/`.SPX`/`$SPX`/`^SPX` in both
  `US_STOCK` and `US_INDEX`. `fetchSpxPrice()` derives the level from put-call
  parity on 9 strikes around `SPY x 10.06` (median of `K + Cmid - Pmid`).
  SPY x 10 alone is ~45 points off, so it is only used to aim the strikes, and
  as a 1.5% sanity check. Returns null (entry skipped as `no_price`) if fewer
  than 3 strikes have usable quotes.
- **Tick size**: $0.05 under $3.00, $0.10 from $3.00. `snapToTick()` rounds buys
  up and sells down. Preview does NOT enforce ticks (accepted 36.37), so
  whether a real place rejects an off-tick price is unverified; snapping is
  the safe assumption.
- **Cash-settled, European**: no assignment into shares, so the SPY agent's
  "close it by hand or get 100 shares" warning is gone; a stranded position
  just settles at intrinsic. Premium is ~10x SPY's (~$2,000/contract at $1 ITM
  equivalent), so dollar P&L per trade is ~10x.
- Quotes are 15 min delayed (`delay_minutes: 15`), same as SPY.

## Files

- `main.ts`, `tradeLogger.ts` (`spx-trades.jsonl`, `spx-state.json`),
  `testSpxChain.ts [YYYY-MM-DD]` (live check + BUY_TO_OPEN preview, no order).
- `.github/workflows/spx-0dte.yml`: concurrency group `spx-0dte`.

## Status as of 2026-10-16 (initial build)

Verified live: option chain (SPXW 0DTE), snapshots, parity level (7654.25 vs
SPY-implied 7667), strike pick, BUY_TO_OPEN preview (accepted, est. $1,660).

**Not verified** (needs a real trading run): an actual fill, off-tick rejection
behavior, SELL_TO_CLOSE, and the **positions shape for an SPXW position**
(`findHeldCall()` accepts position `symbol` of either `SPX` or `SPXW` since the
real one is unseen; check this first if a resume/exit ever misses a position).
Hosting set up 2026-10-16: public repo `Pedrazar/webull-spx-0dte-agent`, 4 repo secrets, cron-job.org dispatch (`20 7 * * 1-5` America/Los_Angeles). First scheduled run: Monday 2026-10-19.

Both agents share one paper account; each only matches its own symbol.
