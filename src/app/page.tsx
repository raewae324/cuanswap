"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getChainStatus, getPublicClient, CHAIN_ID, RPC_URL, EXPLORER_URL, SDK_VERSION, SLOT } from "../lib/ammora";
import type { WalletState } from "../components/WalletConnect";

// The SDK components touch window.ethereum and the browser transport —
// render them client-side only.
const WalletConnect = dynamic(() => import("../components/WalletConnect"), { ssr: false });
const SwapBox = dynamic(() => import("../components/SwapBox"), { ssr: false });
const Launchpad = dynamic(() => import("../components/Launchpad"), { ssr: false });
const TokenList = dynamic(() => import("../components/TokenList"), { ssr: false });

export default function Home() {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    chainId: null,
    ethBalance: null,
    wethBalance: null,
  });
  const [chainStatus, setChainStatus] = useState<{
    chainId: number;
    blockNumber: bigint;
    finalizedHead: bigint;
  } | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  const loadChain = useCallback(async () => {
    setChainError(null);
    try {
      const client = getPublicClient();
      setChainStatus(await getChainStatus(client));
    } catch (e) {
      setChainError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadChain();
  }, [loadChain]);

  return (
    <main>
      <header>
        <h1>CuanSwap</h1>
        <p>
          Minimal demo exchange / launchpad, built with the Ammora SDK {SDK_VERSION} (auto-route · V4 · concentrated
          graduation). Test ETH only — $0 value · no mainnet.
        </p>
        <p className="dim small">
          Docs: ammora-docs.vercel.app/guides/partner-quickstart + /guides/launchpad · SDK @ammora-protocol/sdk@
          {SDK_VERSION} · RPC {RPC_URL} · Explorer {EXPLORER_URL}
        </p>
        <p className="dim small">
          Chain {CHAIN_ID} (GIWA Sepolia) · slot {SLOT}
        </p>
      </header>

      <section className="card">
        <h2>Live chain status <span className="dim">(read-only)</span></h2>
        {chainStatus ? (
          <p>
            Chain ID: <b>{chainStatus.chainId}</b> · head block: <b>{chainStatus.blockNumber.toString()}</b> ·
            finalized head: <b>{chainStatus.finalizedHead.toString()}</b>{" "}
            <button onClick={loadChain}>Refresh</button>
          </p>
        ) : chainError ? (
          <p className="err">{chainError}</p>
        ) : (
          <p>Loading live chain status…</p>
        )}
      </section>

      <WalletConnect wallet={wallet} onChange={setWallet} />
      <SwapBox wallet={wallet} />
      <Launchpad wallet={wallet} />
      <TokenList />

      <footer>
        <p className="dim small">
          CuanSwap is a testnet demo for the Ammora Season 2 builder mission. Built with the Ammora SDK on GIWA
          Sepolia. Nothing here is financial advice; testnet tokens have no value. The app never holds a private key
          — every transaction is signed by you in your own wallet.
        </p>
      </footer>
    </main>
  );
}
