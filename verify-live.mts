// Verifies CuanSwap's own lib (src/lib/ammora.ts) against the live GIWA
// Sepolia RPC, using the exact code paths the browser UI calls.
// Read-only except for building unsigned tx plans (never sent).
import {
  buildCreateLaunchPreview,
  discoverLaunches,
  getChainStatus,
  getPublicClient,
  getRouteQuote,
  listConfigs,
  planDbcSwap,
  readCurveState,
  WETH,
  fmtUnits,
} from "./src/lib/ammora.ts";
import { ATT_CURVE, KNOWN_PAIRS } from "./src/lib/tokens.ts";

const RECIPIENT = "0x8d7348A49Ca6eaF126c4FE06B5de60D0f11969fC" as const;

async function main() {
  const client = getPublicClient();

  console.log("== chain status ==");
  const st = await getChainStatus(client);
  console.log("chainId:", st.chainId, "| head:", st.blockNumber.toString(), "| finalized:", st.finalizedHead.toString());

  console.log("== route quotes (app code path) ==");
  for (const pair of KNOWN_PAIRS) {
    const inTok = pair.tokenA;
    const outTok = pair.tokenB;
    const q = await getRouteQuote({
      model: pair.model,
      pool: pair.pool,
      tokenIn: inTok.address,
      tokenOut: outTok.address,
      amountIn: 10n ** 16n, // 0.01 WETH
      recipient: RECIPIENT,
      slippageBps: 50,
    });
    console.log(
      `${pair.label}: 0.01 WETH -> ${fmtUnits(q.expectedAmountOut, outTok.decimals)} ${outTok.symbol} (min ${fmtUnits(q.minimumAmountOut, outTok.decimals)}, impact ${q.priceImpactBps} bps, hops: ${q.hops.map((h) => h.model).join(",")})`,
    );
  }

  console.log("== configs (app code path) ==");
  const configs = await listConfigs(client, 10);
  for (const c of configs) {
    console.log(`#${c.configId} enabled=${c.enabled} quote=${c.quoteToken.slice(0, 10)}… migrationMode=${c.migrationMode}`);
  }

  console.log("== curve state (ATT, app code path) ==");
  const curve = await readCurveState(client, ATT_CURVE);
  console.log(
    `status=${curve.status} configId=${curve.configId} quoteReserve=${fmtUnits(curve.quoteReserve, 18)} WETH threshold=${fmtUnits(curve.migrationQuoteThreshold, 18)} WETH`,
  );

  console.log("== create-launch preview (no broadcast) ==");
  const preview = await buildCreateLaunchPreview({
    name: "Cuan Token",
    symbol: "CUAN",
    metadataURI: "ipfs://example/cuan-metadata.json",
    configId: 7n,
  });
  console.log(`to=${preview.to} value=${preview.value} dataBytes=${preview.data.length / 2 - 1} configHash=${preview.configHash.slice(0, 18)}… decimals=${preview.tokenDecimals}`);

  console.log("== dbc swap plan (no send) ==");
  const plan = await planDbcSwap({
    curve: ATT_CURVE,
    tokenIn: WETH,
    amountIn: 10n ** 16n,
    recipient: RECIPIENT,
    slippageBps: 50,
  });
  console.log(
    `tx to=${plan.transaction.to} value=${plan.transaction.value} expectedOut=${fmtUnits(plan.expectedAmountOut, 9)} ATT minOut=${fmtUnits(plan.minimumAmountOut, 9)} approval=${plan.approval ? `${plan.approval.token.slice(0, 10)}… -> ${plan.approval.spender.slice(0, 10)}…` : "none"}`,
  );

  console.log("== discovery (app code path) ==");
  const launches = await discoverLaunches(client, 100000, 10000);
  console.log(`launches in last 100k blocks: ${launches.length}; latest block ${launches[0]?.block.toString()} token ${launches[0]?.token} curve ${launches[0]?.curve} config #${launches[0]?.configId}`);

  console.log("ALL APP CODE PATHS VERIFIED LIVE");
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
