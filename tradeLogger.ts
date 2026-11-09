/**
 * Append-only event log (spx-trades.jsonl) plus a small per-day state
 * snapshot (spx-state.json). Same convention as the sibling projects: the
 * log is never rewritten or truncated, only appended to.
 *
 * spx-state.json is only used for one decision — "did we already enter
 * today?" — so a same-day re-dispatch of the workflow can't buy a second
 * time after the first position was already stopped out. Whether a
 * position is open right now always comes from the broker, never from here.
 */

import fs from "fs";
import path from "path";

const LOG_PATH = path.join(__dirname, "spx-trades.jsonl");
const STATE_PATH = path.join(__dirname, "spx-state.json");

export type SpyEvent =
  | {
      event: "entry_filled";
      optionSymbol: string;
      strike: number;
      expiration: string;
      contracts: number;
      entryPrice: number; // per-contract premium paid (per share, x100 for dollars)
      totalCost: number;
      /** SPX's level at decision time and the exact strike target
       * (level - STRIKE_OFFSET) — `strike` is the nearest listed strike. */
      underlyingPrice: number;
      targetStrike: number;
      clientOrderId: string;
    }
  | {
      event: "exit_filled";
      optionSymbol: string;
      reason: "stop_loss" | "trailing_stop" | "eod";
      contracts: number;
      entryPrice: number;
      exitPrice: number; // weighted average across fills
      realizedPnl: number;
      pctReturn: number;
    }
  | {
      event: "resumed";
      optionSymbol: string;
      contracts: number;
      entryPrice: number;
      detail: string;
    }
  | {
      event: "position_gone";
      optionSymbol: string;
      detail: string;
    }
  | {
      event: "skipped";
      reason: "holiday" | "already_entered_today" | "past_entry_window" | "daily_risk_limit" | "early_close" | "no_0dte_contract" | "no_quote" | "no_price" | "order_not_filled";
      detail: string;
    }
  | {
      event: "exit_failed";
      optionSymbol: string;
      reason: "stop_loss" | "trailing_stop" | "eod";
      detail: string;
    };

/** Which of the day's two entry slots is running (morning 10:30, midday
 * 12:30 ET). Sequential, so one process-wide value is enough; every logged
 * event carries it. Older log lines have no `slot` (= morning). */
export type Slot = "morning" | "midday";
let currentSlot: Slot = "morning";
export function setSlot(s: Slot): void {
  currentSlot = s;
}
export function getSlot(): Slot {
  return currentSlot;
}

export function logEvent(e: SpyEvent): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), slot: currentSlot, ...e });
  fs.appendFileSync(LOG_PATH, line + "\n");
  console.log(`[event] ${line}`);
}

/** One entry slot's trade. The morning trade lives flat on DayState (the
 * original shape, so nothing reading the state file breaks); the midday
 * trade lives under `midday`. */
export interface TradeState {
  entered: boolean;
  optionSymbol?: string;
  strike?: number;
  contracts?: number;
  entryPrice?: number;
  exitPrice?: number;
  exitReason?: "stop_loss" | "trailing_stop" | "eod";
  realizedPnl?: number;
}

export interface DayState extends TradeState {
  date: string; // NY date
  midday?: TradeState;
}

export function readState(): DayState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as DayState;
  } catch {
    return null;
  }
}

export function writeState(s: DayState): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + "\n");
}

/** Merges a patch into the current slot's trade record for `date` (starting a
 * fresh day record if the file holds an older date). */
export function saveTrade(date: string, patch: Partial<TradeState>): void {
  const cur = readState();
  const base: DayState = cur?.date === date ? cur : { date, entered: false };
  if (currentSlot === "morning") writeState({ ...base, ...patch });
  else writeState({ ...base, midday: { entered: false, ...base.midday, ...patch } });
}
