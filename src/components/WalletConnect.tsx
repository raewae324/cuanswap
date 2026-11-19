"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CHAIN_ID,
  GIWA_SEPOLIA,
  WETH,
  buildWrapTx,
  ensureGiwaChain,
  explorerAddress,
  fmtUnits,
  getEthBalance,
  getPublicClient,
  getTokenBalance,
  getWalletClient,
  hasInjectedWallet,
  shortAddress,
  type Address,
} from "../lib/ammora";

export interface WalletState {
  address: Address | null;
  chainId: number | null;
  ethBalance: bigint | null;
  wethBalance: bigint | null;
}

export default function WalletConnect({
  wallet,
  onChange,
  variant,
}: {
  wallet: WalletState;
  onChange: (w: WalletState) => void;
  variant: "header" | "panel";
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wrapAmount, setWrapAmount] = useState("0.1");
  const [wrapTx, setWrapTx] = useState<string | null>(null);

  const refresh = useCallback(
    async (address: Address) => {
      try {
        const client = getPublicClient();
        const [chainId, eth, weth] = await Promise.all([
          client.getChainId(),
          getEthBalance(client, address),
          getTokenBalance(client, WETH, address),
        ]);
        onChange({ address, chainId, ethBalance: eth, wethBalance: weth });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [onChange],
  );

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (!hasInjectedWallet()) throw new Error("No wallet found. Install MetaMask or Rabby, then reload.");
      await ensureGiwaChain();
      const wc = await getWalletClient();
      const [address] = await wc.requestAddresses();
      if (!address) throw new Error("Wallet returned no address.");
      await refresh(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // Reconnect silently if the wallet is already unlocked + on the right chain.
  useEffect(() => {
    if (!hasInjectedWallet() || wallet.address) return;
    (async () => {
      try {
        const wc = await getWalletClient();
        const addresses = await wc.getAddresses().catch(() => [] as Address[]);
        if (addresses[0]) await refresh(addresses[0]);
      } catch {
        /* not connected yet — user clicks Connect */
      }
    })();
  }, [refresh, wallet.address]);

  const wrap = useCallback(async () => {
    setError(null);
    setWrapTx(null);
    if (!wallet.address) {
      setError("Connect your wallet first.");
      return;
    }
    setBusy(true);
    try {
      const amount = BigInt(Math.round(Number(wrapAmount) * 1e18));
      if (amount <= 0n) throw new Error("Enter an ETH amount above 0.");
      await ensureGiwaChain();
      const wc = await getWalletClient();
      const tx = buildWrapTx(amount);
      // The user confirms this wrap in their own wallet. Nothing is auto-sent.
      const hash = await wc.sendTransaction({
        account: wallet.address,
        chain: GIWA_SEPOLIA,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      });
      setWrapTx(hash);
      await refresh(wallet.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [wallet.address, wrapAmount, refresh]);

  const wrongChain = wallet.address !== null && wallet.chainId !== null && wallet.chainId !== CHAIN_ID;

  if (variant === "header") {
    if (!wallet.address) {
      return (
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button id="header-wallet-btn" className="btn-connect" onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect Wallet"}
          </button>
          {error && (
            <span
              className="err"
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                width: 260,
                background: "var(--card)",
                border: "1px solid rgba(255,92,92,0.4)",
                borderRadius: 12,
                padding: "10px 12px",
                fontSize: 12.5,
                lineHeight: 1.5,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                zIndex: 60,
              }}
            >
              {error}
            </span>
          )}
        </span>
      );
    }
    return (
      <button
        className="btn-wallet"
        onClick={connect}
        title={wrongChain ? `Wrong chain (${wallet.chainId}) — click to switch to GIWA Sepolia 91342` : "Click to switch / reconnect"}
      >
        <span className="wallet-dot" />
        {shortAddress(wallet.address)}
        {wrongChain && <span className="warn">· wrong chain</span>}
      </button>
    );
  }

  // Panel variant: balances + wrap, shown under the swap card. Hidden until connected.
  if (!wallet.address) {
    return error ? (
      <div className="wallet-panel">
        <div className="callout callout-err">{error}</div>
      </div>
    ) : null;
  }

  return (
    <div className="wallet-panel">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", margin: "0 0 8px" }}>
          <b style={{ fontSize: 15 }}>
            <a href={explorerAddress(wallet.address)} target="_blank" rel="noreferrer">
              {shortAddress(wallet.address)}
            </a>
          </b>
          <button className="btn" onClick={() => wallet.address && refresh(wallet.address)}>
            Refresh
          </button>
        </div>
        {wrongChain && (
          <div className="callout callout-warn">
            Wrong chain ({wallet.chainId}). Switch to GIWA Sepolia 91342 to swap or launch.
          </div>
        )}
        <div className="wallet-balances">
          <div className="wallet-balance">
            <div className="k">ETH</div>
            <div className="v">{wallet.ethBalance !== null ? fmtUnits(wallet.ethBalance, 18) : "…"}</div>
          </div>
          <div className="wallet-balance">
            <div className="k">WETH</div>
            <div className="v">{wallet.wethBalance !== null ? fmtUnits(wallet.wethBalance, 18) : "…"}</div>
          </div>
        </div>
        <div className="row" style={{ margin: 0 }}>
          <label style={{ margin: 0 }}>
            Wrap ETH → WETH{" "}
            <input
              value={wrapAmount}
              onChange={(e) => setWrapAmount(e.target.value)}
              inputMode="decimal"
              style={{ width: 90 }}
            />
          </label>
          <button className="btn" onClick={wrap} disabled={busy || !wallet.address}>
            {busy ? "…" : "Wrap (you sign)"}
          </button>
        </div>
        {wrapTx && (
          <p className="ok small" style={{ margin: "8px 0 0" }}>
            Wrapped — tx{" "}
            <a href={`https://sepolia-explorer.giwa.io/tx/${wrapTx}`} target="_blank" rel="noreferrer">
              {shortAddress(wrapTx)}
            </a>
          </p>
        )}
        {error && <p className="err small" style={{ margin: "8px 0 0" }}>{error}</p>}
        <p className="wallet-note">
          CuanSwap never asks for a seed phrase or private key. Every transaction is built here and signed by you in
          your own wallet.
        </p>
      </div>
    </div>
  );
}
