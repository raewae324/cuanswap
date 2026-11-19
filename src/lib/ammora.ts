// CuanSwap — Ammora SDK integration layer (GIWA Sepolia, auto-route V4).
// Every SDK call below mirrors the reviewed patterns in ammora-examples
// (src/routing/quote-exact-in.ts, src/quickstart/list-configs.ts,
// src/quickstart/create-launch.ts, src/quickstart/safe-swap.ts).
// Nothing here sends a transaction or holds a key: all sends go through
// the USER's own wallet (MetaMask/Rabby) and are confirmed by the user.
import {
  AmmoraRouteClient,
  AmmoraSwapClient,
  AmmoraV4LaunchCurveClient,
  ammoraLaunchFactoryV4Abi,
  buildCreateAmmoraV4Launch,
  getAmmoraV4ConfigAtBlock,
  getAmmoraV4NextConfigId,
  giwaSepoliaAutoRoute,
  giwaSepoliaAutoRouteCatalog,
  giwaSepoliaAutoRouteDeployment,
  giwaSepoliaAutoRouteDeploymentCatalog,
  giwaSepoliaAutoRoutePoolProfiles,
  resolveAmmoraFinalizedHead,
  type AmmoraRouteQuote,
  type AmmoraSwapModel,
  type AmmoraV4LaunchCurveState,
} from "@ammora-protocol/sdk";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

export type { Address, Hex, PublicClient, WalletClient } from "viem";

// ---------------------------------------------------------------------------
// Chain + deployment constants (verified live against the RPC, 2026-11-19)
// ---------------------------------------------------------------------------
export const CHAIN_ID = 91342;
export const RPC_URL = "https://sepolia-rpc.giwa.io";
export const EXPLORER_URL = "https://sepolia-explorer.giwa.io";
export const SDK_VERSION = "0.3.9";
export const GENERATION = "auto-route";
export const SLOT = "v4-auto-route-20260917";

/** WETH on GIWA Sepolia — the quote token of every launch Config. */
export const WETH: Address = "0x4200000000000000000000000000000000000006";
/** Native ETH placeholder used by the router for native input. */
export const NATIVE_ETH: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** Config #6 is BLOCKED for new launches (graduation bug; it is also
 *  disabled on-chain). Never use it. */
export const BLOCKED_CONFIG_ID = 6n;
/** Default Config for the create-token form: enabled, migrationMode 0,
 *  distinct policy hash (verified live). */
export const DEFAULT_CONFIG_ID = 7n;
/** Default graduation target shown in the launch flow (WETH net quote reserve). */
export const DEFAULT_GRADUATION_TARGET_WETH = "6.5";

export const GIWA_SEPOLIA = defineChain({
  id: CHAIN_ID,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "GIWA Explorer", url: EXPLORER_URL } },
});

export const DEPLOYMENT = giwaSepoliaAutoRouteDeployment;
export const LAUNCH = DEPLOYMENT.contracts.launch;
export const CONFIG_REGISTRY = LAUNCH.configRegistry as Address;
export const LAUNCH_FACTORY = LAUNCH.factory as Address;
export const GRADUATION_ADAPTER = LAUNCH.graduationAdapter as Address;
export const FEE_POLICY = LAUNCH.feePolicy as Address;

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`;

// ---------------------------------------------------------------------------
// Public (read-only) client
// ---------------------------------------------------------------------------
// The public GIWA RPC rate-limits (429 "over rate limit") when calls arrive
// in a burst. Mirror the examples' paced transport: serialize calls with a
// 600 ms gap so the UI does not trip the limit.
export function pacedHttp(url: string, intervalMs = 600): Transport {
  let tail: Promise<unknown> = Promise.resolve();
  let nextStart = 0;
  return (parameters) => {
    const base = http(url, { retryCount: 0 })(parameters);
    return custom({
      request: (args) => {
        const result = tail.then(async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextStart - Date.now())));
          try {
            return await base.request(args);
          } finally {
            nextStart = Date.now() + intervalMs;
          }
        });
        tail = result.catch(() => undefined);
        return result;
      },
    }, { retryCount: 0 })(parameters);
  };
}

export function getPublicClient(): PublicClient {
  return createPublicClient({ chain: GIWA_SEPOLIA, transport: pacedHttp(RPC_URL) });
}

export async function getChainStatus(client: PublicClient) {
  const [chainId, blockNumber, finalizedHead] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    resolveAmmoraFinalizedHead([client], giwaSepoliaAutoRoute.finality),
  ]);
  return { chainId, blockNumber, finalizedHead };
}

// ---------------------------------------------------------------------------
// Swap quotes (read-only, no wallet needed)
// ---------------------------------------------------------------------------
/** Retry a read against the public RPC (it 429s on bursts). */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts`, { cause: last });
}

export interface RouteQuoteParams {
  model: AmmoraSwapModel;
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  recipient: Address;
  slippageBps?: number;
}

export async function getRouteQuote(params: RouteQuoteParams): Promise<AmmoraRouteQuote> {
  return withRetry("Route quote", async () => {
    const client = getPublicClient();
    const verificationBlock = await resolveAmmoraFinalizedHead([client], giwaSepoliaAutoRoute.finality);
    const routes = await AmmoraRouteClient.create({
      chainId: giwaSepoliaAutoRoute.chainId,
      rpcUrls: [RPC_URL],
      routeCatalog: giwaSepoliaAutoRouteCatalog,
      deploymentCatalog: giwaSepoliaAutoRouteDeploymentCatalog,
      factoryProfiles: giwaSepoliaAutoRoutePoolProfiles,
      pools: [{ model: params.model, pool: params.pool }],
      verificationBlock,
    });
    return routes.quoteExactIn({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      recipient: params.recipient,
      slippageBps: params.slippageBps ?? 50,
    });
  });
}

// ---------------------------------------------------------------------------
// Configs (read-only)
// ---------------------------------------------------------------------------
export interface ConfigSummary {
  configId: bigint;
  enabled: boolean;
  configHash: Hex;
  owner: Address;
  feeClaimer: Address;
  quoteToken: Address;
  migrationMode: number;
  segments: number;
}

export async function getNextConfigId(client: PublicClient, blockNumber: bigint): Promise<bigint> {
  return getAmmoraV4NextConfigId(client, CONFIG_REGISTRY, blockNumber);
}

export async function readConfig(client: PublicClient, configId: bigint, blockNumber: bigint) {
  return getAmmoraV4ConfigAtBlock(client, CONFIG_REGISTRY, configId, blockNumber);
}

export async function listConfigs(client: PublicClient, limit: number): Promise<ConfigSummary[]> {
  const blockNumber = await resolveAmmoraFinalizedHead([client], giwaSepoliaAutoRoute.finality);
  const next = await getNextConfigId(client, blockNumber);
  const total = next > 1n ? Number(next - 1n) : 0;
  const count = Math.min(limit, total);
  const out: ConfigSummary[] = [];
  for (let i = 1; i <= count; i++) {
    const entry = await readConfig(client, BigInt(i), blockNumber);
    out.push({
      configId: entry.configId,
      enabled: entry.enabled,
      configHash: entry.configHash,
      owner: entry.identity.owner,
      feeClaimer: entry.identity.feeClaimer,
      quoteToken: entry.config.quoteToken,
      migrationMode: entry.config.migrationMode,
      segments: entry.segments.length,
    });
    // Pace reads on the shared public RPC (600 ms like the examples).
    if (i < count) await new Promise((r) => setTimeout(r, 600));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Launch curve state (graduation progress) — read-only
// ---------------------------------------------------------------------------
export async function readCurveState(
  client: PublicClient,
  curve: Address,
): Promise<AmmoraV4LaunchCurveState> {
  const sdk = new AmmoraV4LaunchCurveClient(client, curve, {
    launchFactory: LAUNCH_FACTORY,
    feePolicy: FEE_POLICY,
  });
  return sdk.getState();
}

export const CURVE_STATUS_LABEL: Record<number, string> = {
  0: "Not started",
  1: "Active — trading on the bonding curve",
  2: "Ready to migrate (graduation reached)",
  3: "Migrated — trading on the post-graduation pool",
  4: "Closed",
};

// ---------------------------------------------------------------------------
// Create-token preview — builds the createLaunch calldata WITHOUT broadcasting.
// The user may later choose to send it with their own wallet; this function
// itself never sends anything.
// ---------------------------------------------------------------------------
export interface CreateLaunchPreview {
  to: Address;
  data: Hex;
  value: bigint;
  configId: bigint;
  configHash: Hex;
  poolCreationFee: bigint;
  tokenDecimals: number;
}

export async function buildCreateLaunchPreview(args: {
  name: string;
  symbol: string;
  metadataURI: string;
  tokenDecimals?: number;
  configId: bigint;
}): Promise<CreateLaunchPreview> {
  if (args.configId === BLOCKED_CONFIG_ID) {
    throw new Error("Config #6 is blocked for new launches (graduation bug). Pick another Config.");
  }
  const client = getPublicClient();
  const blockNumber = await resolveAmmoraFinalizedHead([client], giwaSepoliaAutoRoute.finality);
  const selected = await readConfig(client, args.configId, blockNumber);
  if (!selected.enabled) throw new Error(`Config #${args.configId} is disabled on-chain.`);
  const tokenDecimals = args.tokenDecimals ?? selected.config.tokenDecimals;
  if (tokenDecimals !== selected.config.tokenDecimals) {
    throw new Error(
      `Config #${args.configId} requires ${selected.config.tokenDecimals} token decimals.`,
    );
  }
  const tx = buildCreateAmmoraV4Launch(
    {
      name: args.name,
      symbol: args.symbol,
      metadataURI: args.metadataURI,
      creatorMetadataURI: args.metadataURI,
      tokenDecimals,
    },
    args.configId,
    selected.config.poolCreationFee,
  );
  return {
    to: LAUNCH_FACTORY,
    data: tx.data,
    value: tx.value,
    configId: args.configId,
    configHash: selected.configHash,
    poolCreationFee: selected.config.poolCreationFee,
    tokenDecimals,
  };
}

// ---------------------------------------------------------------------------
// Swap execution planning — builds unsigned txs for the USER's wallet to sign.
// The app never signs or sends anything itself.
// ---------------------------------------------------------------------------
export interface PlannedSwap {
  transaction: { to: Address; data: Hex; value: bigint };
  approval: { token: Address; spender: Address; amount: bigint } | null;
  expectedAmountOut: bigint;
  minimumAmountOut: bigint;
  tokenOut: Address;
}

/** DBC (bonding-curve) swap plan via the curve client. */
export async function planDbcSwap(args: {
  curve: Address;
  tokenIn: Address;
  amountIn: bigint;
  recipient: Address;
  slippageBps?: number;
}): Promise<PlannedSwap> {
  const client = getPublicClient();
  const core = { launchFactory: LAUNCH_FACTORY, feePolicy: FEE_POLICY };
  const sdk = new AmmoraV4LaunchCurveClient(client, args.curve, core);
  const state = await sdk.getState();
  if (state.status !== 1) {
    throw new Error(`Curve status ${state.status} is not active (${CURVE_STATUS_LABEL[state.status] ?? "unknown"}).`);
  }
  const baseForQuote = args.tokenIn.toLowerCase() === state.baseToken.toLowerCase();
  if (!baseForQuote && args.tokenIn.toLowerCase() !== state.quoteToken.toLowerCase()) {
    throw new Error("tokenIn is not one of this curve's assets.");
  }
  const block = await client.getBlock();
  const deadline = block.timestamp + 20n * 60n;
  const planned = await sdk.planSwapExactInput({
    includedAmountIn: args.amountIn,
    baseForQuote,
    allowPartialFill: false,
    slippageBps: args.slippageBps ?? 50,
    recipient: args.recipient,
    deadline,
  });
  return {
    transaction: {
      to: args.curve,
      data: planned.transaction.data,
      value: planned.transaction.value ?? 0n,
    },
    approval: planned.approvalRequirement
      ? {
          token: planned.approvalRequirement.token,
          spender: planned.approvalRequirement.spender,
          amount: planned.approvalRequirement.amount,
        }
      : null,
    expectedAmountOut: planned.quote.amountOut,
    minimumAmountOut: planned.quote.minimumAmountOut,
    tokenOut: baseForQuote ? state.quoteToken : state.baseToken,
  };
}

/** Concentrated / ALMM / compounding swap plan via AmmoraSwapClient. */
export async function planPoolSwap(args: {
  model: Exclude<AmmoraSwapModel, "dbc">;
  pool: Address;
  tokenIn: Address;
  amountIn: bigint;
  payer: Address;
  recipient: Address;
  slippageBps?: number;
}): Promise<PlannedSwap> {
  const client = getPublicClient();
  const swaps = await AmmoraSwapClient.create(client, {
    deploymentCatalog: { [CHAIN_ID]: DEPLOYMENT },
    factoryProfiles: giwaSepoliaAutoRoutePoolProfiles,
  });
  const planned = await swaps.prepareExactIn({
    model: args.model,
    pool: args.pool,
    tokenIn: args.tokenIn,
    inputAsset: "erc20",
    amountIn: args.amountIn,
    payer: args.payer,
    recipient: args.recipient,
    slippageBps: args.slippageBps ?? 50,
    executionMode: "direct-wallet",
  });
  const approval = planned.approvalRequirements?.[0] ?? null;
  return {
    transaction: {
      to: planned.transaction.to,
      data: planned.transaction.data,
      value: planned.transaction.value ?? 0n,
    },
    approval: approval
      ? { token: approval.token, spender: approval.spender, amount: approval.amount }
      : null,
    expectedAmountOut: planned.quote.expectedAmountOut,
    minimumAmountOut: planned.quote.minimumAmountOut,
    tokenOut: planned.quote.tokenOut,
  };
}

// ---------------------------------------------------------------------------
// Token discovery — recent LaunchCreated events (read-only)
// ---------------------------------------------------------------------------
export interface DiscoveredLaunch {
  block: bigint;
  token: Address;
  curve: Address;
  creator: Address;
  configId: bigint;
}

export async function discoverLaunches(
  client: PublicClient,
  blocksBack = 100000,
  chunk = 10000,
): Promise<DiscoveredLaunch[]> {
  const head = await client.getBlockNumber();
  const from0 = head - BigInt(blocksBack);
  const out: DiscoveredLaunch[] = [];
  for (let to = head; to > from0; to -= BigInt(chunk)) {
    const from = to - BigInt(chunk - 1) > from0 ? to - BigInt(chunk - 1) : from0;
    const logs = (await client.getLogs({
      address: LAUNCH_FACTORY,
      event: ammoraLaunchFactoryV4Abi.find((x) => x.type === "event" && x.name === "LaunchCreated") as never,
      fromBlock: from,
      toBlock: to,
    })) as unknown as Array<{
      blockNumber: bigint;
      args: { token: Address; curve: Address; creator: Address; configId: bigint };
    }>;
    for (const l of logs) {
      const a = l.args;
      out.push({ block: l.blockNumber, token: a.token, curve: a.curve, creator: a.creator, configId: a.configId });
    }
  }
  return out.sort((a, b) => (a.block > b.block ? -1 : 1));
}

export interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

export async function getTokenMeta(client: PublicClient, token: Address): Promise<TokenMeta> {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "name" }).catch(() => "?"),
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => "?"),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
    client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }).catch(() => 0n),
  ]);
  return { name: String(name), symbol: String(symbol), decimals: Number(decimals), totalSupply: totalSupply as bigint };
}

// ---------------------------------------------------------------------------
// Wallet (MetaMask / Rabby) — the USER's own wallet; the app never holds keys.
// ---------------------------------------------------------------------------
export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { ethereum?: unknown }).ethereum);
}

export function getInjectedProvider(): unknown {
  return (window as unknown as { ethereum?: unknown }).ethereum;
}

export async function getWalletClient(): Promise<WalletClient> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No wallet found. Install MetaMask or Rabby first.");
  return createWalletClient({
    chain: GIWA_SEPOLIA,
    transport: custom(provider as never),
  });
}

/** Add GIWA Sepolia to the wallet and switch to it. */
export async function ensureGiwaChain(): Promise<void> {
  const provider = getInjectedProvider() as {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  } | null;
  if (!provider) throw new Error("No wallet found. Install MetaMask or Rabby first.");
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${CHAIN_ID.toString(16)}`,
            chainName: "GIWA Sepolia",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function getEthBalance(client: PublicClient, address: Address): Promise<bigint> {
  return client.getBalance({ address });
}

export async function getTokenBalance(client: PublicClient, token: Address, address: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

/** WETH deposit (wrap ETH) — built for the user's wallet to sign. */
export function buildWrapTx(amount: bigint): { to: Address; data: Hex; value: bigint } {
  return {
    to: WETH,
    data: "0xd0e30db0" as Hex, // deposit()
    value: amount,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
export function fmtUnits(value: bigint, decimals: number, maxDp = 6): string {
  const s = formatUnits(value, decimals);
  const [int, frac = ""] = s.split(".");
  return frac ? `${int}.${frac.slice(0, maxDp)}` : int;
}

export function parseAmount(text: string, decimals: number): bigint {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("Enter a positive number.");
  return parseUnits(t, decimals);
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function checksummed(addr: string): Address {
  return getAddress(addr.toLowerCase());
}
