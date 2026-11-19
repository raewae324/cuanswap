"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHAIN_ID,
  GIWA_SEPOLIA,
  explorerTx,
  fmtUnits,
  getPublicClient,
  getWalletClient,
  getRouteQuote,
  parseAmount,
  planDbcSwap,
  planPoolSwap,
  readCurveState,
  shortAddress,
  type Address,
} from "../lib/ammora";
import { KNOWN_PAIRS, type KnownPair } from "../lib/tokens";
import type { AmmoraRouteQuote, AmmoraSwapModel } from "@ammora-protocol/sdk";
import { encodeFunctionData, erc20Abi } from "viem";
import type { WalletState } from "./WalletConnect";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

const SLIPPAGE_PRESETS = [10, 50, 100];

function tokenIconClass(symbol: string): string {
  if (symbol === "WETH") return "weth";
  if (symbol === "ATT") return "att";
  if (symbol === "LODOS") return "lodos";
  return "generic";
}

function tokenGlyph(symbol: string): string {
  if (symbol === "WETH") return "Ξ";
  return symbol.slice(0, 1);
}

function fmtRate(out: string, amountIn: string): string {
  const a = parseFloat(amountIn);
  const o = parseFloat(out);
  if (!a || !o) return "—";
  const r = o / a;
  if (r >= 1000) return r.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (r >= 1) return r.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return r.toFixed(6);
}

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
  // WETH reserve held by the bonding curve (dbc pairs only). A sell needs
  // this reserve to pay out — when it is 0, selling has no route yet.
  const [curveReserve, setCurveReserve] = useState<bigint | null>(null);

  const pair: KnownPair | null = useMemo(
    () => KNOWN_PAIRS.find((p) => p.id === pairId) ?? null,
    [pairId],
  );
  const useCustom = pairId === "custom";
  const model: AmmoraSwapModel = useCustom ? customModel : (pair?.model ?? "dbc");
  const pool: Address | "" = useCustom ? (customPool as Address) : (pair?.pool ?? "");
  const tokenIn = direction === "ab" ? pair?.tokenA : pair?.tokenB;
  const tokenOut = direction === "ab" ? pair?.tokenB : pair?.tokenA;

  // A quote belongs to the exact inputs that produced it — clear it when they change.
  useEffect(() => {
    setQuote(null);
  }, [pairId, direction, amount, slippageBps, customPool, customModel]);

  // For bonding-curve pairs, show how much WETH the curve holds. Selling
  // pays out of this reserve, so a 0 reserve means selling has no route yet.
  useEffect(() => {
    if (model !== "dbc" || !pool) {
      setCurveReserve(null);
      return;
    }
    let cancelled = false;
    readCurveState(getPublicClient(), pool as Address)
      .then((s) => {
        if (!cancelled) setCurveReserve(s.quoteReserve);
      })
      .catch(() => {
        if (!cancelled) setCurveReserve(null);
      });
    return () => {
      cancelled = true;
    };
  }, [model, pool]);

  const flip = useCallback(() => setDirection((d) => (d === "ab" ? "ba" : "ab")), []);

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
      const msg = e instanceof Error ? e.message : String(e);
      const isSell = direction === "ba";
      if (isSell && model === "dbc" && curveReserve !== null && curveReserve === 0n) {
        setError(
          `Belum bisa jual ${inTok.symbol} — curve ini belum ada cadangan WETH (0 WETH), jadi tidak ada yang membayar penjual. Beli ${inTok.symbol} dulu dengan WETH untuk mengisi cadangan, baru jual balik bisa.`,
        );
      } else {
        setError(`No route / quote failed: ${msg}`);
      }
    } finally {
      setQuoting(false);
    }
  }, [pair, pool, model, direction, amount, slippageBps, wallet.address, curveReserve]);

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

  const inIsWeth = inTok?.symbol === "WETH";
  const wethBalance = wallet.wethBalance !== null ? fmtUnits(wallet.wethBalance, 18) : null;

  const setMax = useCallback(() => {
    if (wethBalance !== null) setAmount(wethBalance);
  }, [wethBalance]);

  const connectViaHeader = useCallback(() => {
    document.getElementById("header-wallet-btn")?.click();
  }, []);

  const quoteOut = quote && outTok ? fmtUnits(quote.expectedAmountOut, outTok.decimals) : null;

  const cta = !wallet.address
    ? { label: "Connect Wallet", onClick: connectViaHeader, disabled: false }
    : !quote
      ? { label: quoting ? "Getting quote…" : "Get Quote", onClick: getQuote, disabled: quoting }
      : {
          label: swapping ? "Waiting for your wallet…" : `Swap ${inTok?.symbol} for ${outTok?.symbol}`,
          onClick: swap,
          disabled: swapping,
        };

  return (
    <div className="swap-wrap">
      <div className="swap-card">
        <div className="swap-head">
          <h2>Swap</h2>
          <span className="badge badge-dim">Ammora · auto-route</span>
        </div>

        <div className="pair-tabs" role="tablist" aria-label="Swap pair">
          {KNOWN_PAIRS.map((p) => (
            <button
              key={p.id}
              className={`pair-tab${pairId === p.id ? " active" : ""}`}
              onClick={() => setPairId(p.id)}
            >
              {p.tokenA.symbol} ↔ {p.tokenB.symbol}
            </button>
          ))}
          <button
            className={`pair-tab${useCustom ? " active" : ""}`}
            onClick={() => setPairId("custom")}
          >
            Custom
          </button>
        </div>

        {model === "dbc" && curveReserve !== null && (
          <p className="swap-note" style={{ margin: "2px 0 0" }}>
            Curve reserve: <b>{fmtUnits(curveReserve, 18)} WETH</b>
            {curveReserve === 0n
              ? " — selling is not possible yet; buy first to seed the reserve."
              : ""}
          </p>
        )}

        {useCustom && (
          <div className="custom-panel">
            <label>
              Pool model
              <select value={customModel} onChange={(e) => setCustomModel(e.target.value as AmmoraSwapModel)}>
                <option value="dbc">dbc (bonding curve)</option>
                <option value="concentrated">concentrated</option>
                <option value="almm">almm</option>
                <option value="compounding">compounding</option>
              </select>
            </label>
            <label>
              Pool / curve address
              <input value={customPool} onChange={(e) => setCustomPool(e.target.value)} placeholder="0x…" />
            </label>
          </div>
        )}

        {/* You pay */}
        <div className="swap-field">
          <div className="swap-field-label">
            <span>You pay</span>
            <span className="swap-field-balance">
              {wallet.address && inIsWeth && wethBalance !== null ? (
                <>
                  Balance: {wethBalance} WETH{" "}
                  <button className="btn-mini" onClick={setMax} type="button">
                    MAX
                  </button>
                </>
              ) : (
                <span>&nbsp;</span>
              )}
            </span>
          </div>
          <div className="swap-field-body">
            <input
              className="swap-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.0"
              aria-label="Amount to pay"
            />
            {inTok && (
              <button className="token-chip" onClick={flip} title="Switch direction" type="button">
                <span className={`token-icon ${tokenIconClass(inTok.symbol)}`}>{tokenGlyph(inTok.symbol)}</span>
                {inTok.symbol}
                <span className="chev">▾</span>
              </button>
            )}
          </div>
        </div>

        <div className="flip-row">
          <button className="flip-btn" onClick={flip} title="Switch direction" type="button" aria-label="Switch swap direction">
            ↓
          </button>
        </div>

        {/* You receive */}
        <div className="swap-field">
          <div className="swap-field-label">
            <span>You receive</span>
            <span>{quote && inTok && outTok ? `1 ${inTok.symbol} = ${fmtRate(quoteOut ?? "0", amount)} ${outTok.symbol}` : <span>&nbsp;</span>}</span>
          </div>
          <div className="swap-field-body">
            <div className={`swap-amount-output${quoteOut === null ? " dimmed" : ""}`}>
              {quoting ? "…" : (quoteOut ?? "0.0")}
            </div>
            {outTok && (
              <button className="token-chip" onClick={flip} title="Switch direction" type="button">
                <span className={`token-icon ${tokenIconClass(outTok.symbol)}`}>{tokenGlyph(outTok.symbol)}</span>
                {outTok.symbol}
                <span className="chev">▾</span>
              </button>
            )}
          </div>
        </div>

        {/* Slippage */}
        <div className="swap-slippage">
          <span>Slippage tolerance</span>
          <span className="slippage-chips">
            {SLIPPAGE_PRESETS.map((bps) => (
              <button
                key={bps}
                className={`slippage-chip${slippageBps === bps ? " active" : ""}`}
                onClick={() => setSlippageBps(bps)}
                type="button"
              >
                {(bps / 100).toFixed(1)}%
              </button>
            ))}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              className="slippage-input"
              type="number"
              value={slippageBps}
              onChange={(e) => setSlippageBps(Number(e.target.value))}
              aria-label="Slippage in basis points"
            />
            <span>bps</span>
          </span>
        </div>

        {/* Details */}
        {quote && outTok && (
          <div className="swap-details">
            <div className="swap-details-row">
              <span className="k">You receive ≈</span>
              <span className="v">
                <b>{quoteOut}</b> {outTok.symbol}
              </span>
            </div>
            <div className="swap-details-row">
              <span className="k">Minimum received</span>
              <span className="v">
                {fmtUnits(quote.minimumAmountOut, outTok.decimals)} {outTok.symbol} (after {quote.slippageBps}{" "}
                bps slippage)
              </span>
            </div>
            <div className="swap-details-row">
              <span className="k">Price impact</span>
              <span className="v">{quote.priceImpactBps !== null ? `${quote.priceImpactBps} bps` : "n/a"}</span>
            </div>
            <div className="swap-details-row">
              <span className="k">Route</span>
              <span className="v">{quote.hops.map((h) => `${h.model} ${shortAddress(h.pool)}`).join(" → ")}</span>
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="swap-cta-wrap">
          <button className="btn-primary" onClick={cta.onClick} disabled={cta.disabled}>
            {cta.label}
          </button>
        </div>

        {pair && !quote && <p className="swap-note">{pair.note}</p>}

        {txs.length > 0 && (
          <div className="swap-txs">
            {txs.map((t) => (
              <p key={t.hash} className="ok" style={{ margin: "4px 0" }}>
                {t.label}:{" "}
                <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer">
                  {shortAddress(t.hash)}
                </a>
              </p>
            ))}
          </div>
        )}
        {error && <div className="swap-error">{error}</div>}
      </div>
    </div>
  );
}
