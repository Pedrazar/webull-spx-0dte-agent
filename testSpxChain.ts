/**
 * Live sandbox check for everything main.ts depends on, WITHOUT placing an
 * order: SPX level (put-call parity), the SPXW 0DTE CALL chain (pass a date
 * to test a future expiry on a non-trading day), strike pick, snapshot, and
 * a BUY_TO_OPEN preview.
 *
 *   npx tsx testSpxChain.ts [YYYY-MM-DD]
 *
 * Note: fetchSpxPrice() derives the level from TODAY's SPXW options, so it
 * needs a trading day with an SPXW expiry today; the chain/preview half
 * works for any date.
 */

import "dotenv/config";
import { WebullClient } from "./webullClient";
import { getOptionChain, getOptionSnapshot, previewOptionOrder } from "./optionsClient";
import { todayNyDate } from "./marketHours";
import { fetchSpxPrice, pickStrikeNearest } from "./main";

async function run() {
  const baseUrl = process.env.WEBULL_BASE_URL!;
  const accountId = process.env.WEBULL_SANDBOX_ACCOUNT_ID!;
  const client = new WebullClient({
    appKey: process.env.WEBULL_APP_KEY!,
    appSecret: process.env.WEBULL_APP_SECRET!,
    baseUrl,
    host: new URL(baseUrl).host,
  });

  const expiry = process.argv[2] ?? todayNyDate();
  const price = await fetchSpxPrice(client);
  console.log("SPX level (parity):", price);
  if (price === null) return;

  const chain = (
    await getOptionChain(client, {
      underlyingSymbol: "SPX",
      optionType: "CALL",
      startDate: expiry,
      endDate: expiry,
      strikePriceGte: Math.floor(price - 40),
      strikePriceLte: Math.ceil(price + 40),
    })
  ).filter((c) => c.expiration_date === expiry && c.root_symbol === "SPXW");
  console.log(`SPXW chain for ${expiry}: ${chain.length} contracts`);

  const target = price - parseFloat(process.env.SPX_STRIKE_OFFSET ?? "10");
  const contract = pickStrikeNearest(chain, target);
  console.log(`target strike ${target.toFixed(2)} -> picked`, contract?.symbol, contract?.strike_price);
  if (!contract) return;

  const snap = await getOptionSnapshot(client, [contract.symbol]);
  console.log("snapshot:", JSON.stringify(snap[0], null, 2));
  const ask = snap[0]?.ask ? parseFloat(snap[0].ask) : parseFloat(snap[0]?.price ?? "0");

  const preview = await previewOptionOrder(client, accountId, {
    underlyingSymbol: "SPXW",
    optionSymbol: contract.symbol,
    side: "BUY",
    quantity: 1,
    optionType: "CALL",
    strikePrice: parseFloat(contract.strike_price),
    expirationDate: expiry,
    limitPrice: ask,
    positionIntent: "BUY_TO_OPEN",
  }).catch((e) => `PREVIEW ERROR: ${e}`);
  console.log("preview BUY_TO_OPEN:", JSON.stringify(preview, null, 2));
}

run();
