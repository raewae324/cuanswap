"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CHAIN_ID,
  GIWA_SEPOLIA,
  explorerTx,
  fmtUnits,
  getPublicClient,
  getRouteQuote,
  getTokenBalance,
  getWalletClient,
  parseAmount,
  planDbcSwap,
  planPoolSwap,
  shortAddress,
  type Address,
} from "../lib/ammora";
import { KNOWN_PAIRS, type KnownPair } from "../lib/tokens";
import type { AmmoraRouteQuote, AmmoraSwapModel } from "@ammora-protocol/sdk";
import { encodeFunctionData, erc20Abi } from "viem";
import type { WalletState } from "./WalletConnect";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

export default function SwapBox({ wallet }: { wallet: WalletState }) {
  const [pairId, setPairId] = useState<string>(KNOWN_PAIRS[0].id);
  const [customModel, setCustomModel] = useState<AmmoraSwapModel>("dbc");
  const [customPool, setCustomPool] = useState("");
  const [direction, setDirection] = useState<"ab" | "ba">("ab");
  const [amount, setAmount] = useState("0.01");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<AmmoraRouteQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<{ label: string; hash: string }[]>([]);

  const pair: KnownPair | null = useMemo(
    () => KNOWN_PAIRS.find((p) => p.id === pairId) ?? null,
    [pairId],
  );
  const useCustom = pairId === "custom";
  const model: AmmoraSwapModel = useCustom ? customModel : (pair?.model ?? "dbc");
  const pool: Address | "" = useCustom ? (customPool as Address) : (pair?.pool ?? "");
  const tokenIn = direction === "ab" ? (useCustom ? pair?.tokenA : pair?.tokenA) : pair?.tokenB;
  const tokenOut = direction === "ab" ? pair?.tokenB : pair?.tokenA;

  const getQuote = useCallback(async () => {
    setError(null);
    setQuote(null);
    if (!pair || !pool) {
      setError("Pick a pair (or enter a pool address for a custom route).");
      return;
    }
    const inTok = direction === "ab" ? pair.tokenA : pair.tokenB;
    const outTok = direction === "ab" ? pair.tokenB : pair.tokenA;
    let amountIn: bigint;
    try {
      amountIn = parseAmount(amount, inTok.decimals);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (amountIn <= 0n) {
      setError("Enter an amount above 0.");
      return;
    }
    setQuoting(true);
    try {
      const q = await getRouteQuote({
        model,
        pool: pool as Address,
        tokenIn: inTok.address,
        tokenOut: outTok.address,
        amountIn,
        recipient: wallet.address ?? ZERO,
        slippageBps,
      });
      setQuote(q);
    } catch (e) {
      setError(`No route / quote failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQuoting(false);
    }
  }, [pair, pool, model, direction, amount, slippageBps, wallet.address]);

  const swap = useCallback(async () => {
    setError(null);
    setTxs([]);
    if (!wallet.address) {
      setError("Connect your wallet first — swaps are signed by you in MetaMask/Rabby.");
      return;
    }
    if (!pair || !pool || !quote) {
      setError("Get a quote first.");
      return;
    }
    if (wallet.chainId !== CHAIN_ID) {
      setError("Wrong chain — switch to GIWA Sepolia 91342 first.");
      return;
    }
    const inTok = direction === "ab" ? pair.tokenA : pair.tokenB;
    const amountIn = parseAmount(amount, inTok.decimals);
    setSwapping(true);
    try {
      const client = getPublicClient();
      const planned =
        model === "dbc"
          ? await planDbcSwap({
              curve: pool as Address,
              tokenIn: inTok.address,
              amountIn,
              recipient: wallet.address,
              slippageBps,
            })
          : await planPoolSwap({
              model: model as Exclude<AmmoraSwapModel, "dbc">,
              pool: pool as Address,
              tokenIn: inTok.address,
              amountIn,
              payer: wallet.address,
              recipient: wallet.address,
              slippageBps,
            });
      const wc = await getWalletClient();
      // 1) ERC20 approval first, only if the allowance is short. You sign it.
      if (planned.approval) {
        const allowance = (await client.readContract({
          address: planned.approval.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet.address, planned.approval.spender],
        })) as bigint;
        if (allowance < planned.approval.amount) {
          const approveHash = await wc.sendTransaction({
            account: wallet.address,
            chain: GIWA_SEPOLIA,
            to: planned.approval.token,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [planned.approval.spender, planned.approval.amount],
            }),
          });
          setTxs((t) => [...t, { label: "Approve", hash: approveHash }]);
          await client.waitForTransactionReceipt({ hash: approveHash });
        }
      }
      // 2) The swap itself. You confirm it in your wallet — nothing is auto-sent.
      const hash = await wc.sendTransaction({
        account: wallet.address,
        chain: GIWA_SEPOLIA,
        to: planned.transaction.to,
        data: planned.transaction.data,
        value: planned.transaction.value,
      });
      setTxs((t) => [...t, { label: "Swap", hash }]);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Swap transaction reverted: ${hash}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwapping(false);
    }
  }, [wallet, pair, pool, quote, model, direction, amount, slippageBps]);

  const inTok = direction === "ab" ? pair?.tokenA : pair?.tokenB;
  const outTok = direction === "ab" ? pair?.tokenB : pair?.tokenA;

  return (
    <section className="card">
      <h2>2 · Swap — read-only quote</h2>
      <p className="dim small">
        Quote via <code>AmmoraRouteClient.quoteExactIn</code> (the call from ammora-examples
        src/routing/quote-exact-in.ts). Quote only — no approve, no swap, no send. Slippage 50 bps · recipient = your
        connected wallet. If there is no route for this pair, the quote fails and no price is shown — that is honest,
        not a bug.
      </p>

      <label>
        Pair:{" "}
        <select value={pairId} onChange={(e) => setPairId(e.target.value)}>
          {KNOWN_PAIRS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom pool…</option>
        </select>
      </label>

      {useCustom && (
        <div className="row" style={{ marginTop: 8 }}>
          <label>
            Pool model:{" "}
            <select value={customModel} onChange={(e) => setCustomModel(e.target.value as AmmoraSwapModel)}>
              <option value="dbc">dbc (bonding curve)</option>
              <option value="concentrated">concentrated</option>
              <option value="almm">almm</option>
              <option value="compounding">compounding</option>
            </select>
          </label>
          <label>
            Pool / curve address:{" "}
            <input
              value={customPool}
              onChange={(e) => setCustomPool(e.target.value)}
              placeholder="0x…"
              style={{ width: 380 }}
            />
          </label>
        </div>
      )}

      <div className="row" style={{ marginTop: 8 }}>
        <label>
          You pay:{" "}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={{ width: 110 }} />{" "}
          {inTok?.symbol}
        </label>
        <button onClick={() => setDirection((d) => (d === "ab" ? "ba" : "ab"))} title="Flip direction">
          ⇄ {inTok?.symbol} → {outTok?.symbol}
        </button>
        <label>
          Slippage:{" "}
          <input
            type="number"
            value={slippageBps}
            onChange={(e) => setSlippageBps(Number(e.target.value))}
            style={{ width: 70 }}
          />{" "}
          bps
        </label>
        <button onClick={getQuote} disabled={quoting}>
          {quoting ? "Quoting…" : "Get quote"}
        </button>
      </div>

      {pair && <p className="dim small">{pair.note}</p>}

      {quote && outTok && (
        <div className="quote">
          <p>
            You receive ≈ <b>{fmtUnits(quote.expectedAmountOut, outTok.decimals)}</b> {outTok.symbol}
          </p>
          <p>
            Minimum (after {quote.slippageBps} bps slippage):{" "}
            <b>{fmtUnits(quote.minimumAmountOut, outTok.decimals)}</b> {outTok.symbol}
          </p>
          <p>
            Price impact: {quote.priceImpactBps !== null ? `${quote.priceImpactBps} bps` : "n/a"}
            {" · "}Route: {quote.hops.map((h) => `${h.model} ${shortAddress(h.pool)}`).join(" → ")}
          </p>
          <div className="row">
            <button onClick={swap} disabled={swapping || !wallet.address}>
              {swapping ? "Waiting for your wallet…" : "Swap (you sign in your wallet)"}
            </button>
            {!wallet.address && <span className="dim small">Connect a wallet above to swap.</span>}
          </div>
        </div>
      )}

      {txs.length > 0 && (
        <div>
          {txs.map((t) => (
            <p key={t.hash} className="ok">
              {t.label}:{" "}
              <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer">
                {shortAddress(t.hash)}
              </a>
            </p>
          ))}
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </section>
  );
}
