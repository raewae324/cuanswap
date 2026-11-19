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
}: {
  wallet: WalletState;
  onChange: (w: WalletState) => void;
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

  return (
    <section className="card">
      <h2>1 · Wallet <span className="dim">(GIWA Sepolia only)</span></h2>
      {wallet.address ? (
        <div>
          <p>
            Connected:{" "}
            <a href={explorerAddress(wallet.address)} target="_blank" rel="noreferrer">
              {shortAddress(wallet.address)}
            </a>
            {wrongChain && (
              <span className="warn"> — wrong chain ({wallet.chainId}). Switch to GIWA Sepolia 91342.</span>
            )}
          </p>
          <p>
            ETH: <b>{wallet.ethBalance !== null ? fmtUnits(wallet.ethBalance, 18) : "…"}</b>
            {" · "}WETH: <b>{wallet.wethBalance !== null ? fmtUnits(wallet.wethBalance, 18) : "…"}</b>
          </p>
          <div className="row">
            <button onClick={() => wallet.address && refresh(wallet.address)}>Refresh balances</button>
            <button onClick={connect} disabled={busy}>
              {busy ? "…" : "Switch / reconnect"}
            </button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label>
              Wrap ETH → WETH:{" "}
              <input
                value={wrapAmount}
                onChange={(e) => setWrapAmount(e.target.value)}
                inputMode="decimal"
                style={{ width: 90 }}
              />{" "}
              ETH
            </label>
            <button onClick={wrap} disabled={busy || !wallet.address}>
              {busy ? "…" : "Wrap (you sign in wallet)"}
            </button>
          </div>
          {wrapTx && (
            <p className="ok">
              Wrapped — tx{" "}
              <a href={`https://sepolia-explorer.giwa.io/tx/${wrapTx}`} target="_blank" rel="noreferrer">
                {shortAddress(wrapTx)}
              </a>
            </p>
          )}
        </div>
      ) : (
        <div>
          <p>No wallet connected yet. Connect MetaMask / Rabby — the app will switch (or add) GIWA Sepolia 91342.</p>
          <button onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      )}
      {error && <p className="err">{error}</p>}
      <p className="dim small">
        CuanSwap never asks for a seed phrase or private key. Every transaction is built here and signed by you in
        your own wallet.
      </p>
    </section>
  );
}
