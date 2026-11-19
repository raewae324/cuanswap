// Test reverse quote: ATT -> WETH (selling the Ammora test token back).
// Uses the app's own getRouteQuote code path.
import { getRouteQuote, getPublicClient, parseAmount } from "./src/lib/ammora.ts";
import { ATT_CURVE } from "./src/lib/tokens.ts";

const WETH = "0x4200000000000000000000000000000000000006" as const;
const ATT = "0xadB43dfDCDD78546912FB988D0D5E477926031a5" as const;
const RECIPIENT = "0x8d7348A49Ca6eaF126c4FE06B5de60D0f11969fC" as const; // Adil's wallet, like the app uses when connected

const client = getPublicClient();
console.log("chain head:", await client.getBlockNumber());

// 1) Buy: 0.01 WETH -> ATT (known working)
const buy = await getRouteQuote({
  model: "dbc",
  pool: ATT_CURVE,
  tokenIn: WETH,
  tokenOut: ATT,
  amountIn: parseAmount("0.01", 18),
  recipient: RECIPIENT,
  slippageBps: 50,
});
console.log("BUY 0.01 WETH -> ATT:", buy.expectedAmountOut.toString(), "raw (9 dec)");

// 2) Sell: 1000 ATT -> WETH (the reverse Adil wants)
const sell = await getRouteQuote({
  model: "dbc",
  pool: ATT_CURVE,
  tokenIn: ATT,
  tokenOut: WETH,
  amountIn: parseAmount("1000", 9),
  recipient: RECIPIENT,
  slippageBps: 50,
});
console.log("SELL 1000 ATT -> WETH:", sell.expectedAmountOut.toString(), "raw (18 dec)");
console.log("SELL price impact bps:", sell.priceImpactBps);
console.log("SELL min out:", sell.minimumAmountOut.toString());
console.log("REVERSE QUOTE OK");
