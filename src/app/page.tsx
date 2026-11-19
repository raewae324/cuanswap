"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getChainStatus, getPublicClient, CHAIN_ID, SDK_VERSION } from "../lib/ammora";
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
    <>
      <header className="topnav">
        <div className="topnav-inner">
          <div className="logo">
            <span className="logo-mark">C</span>
            <span className="logo-name">CuanSwap</span>
            <span className="logo-tag">Testnet</span>
          </div>
          <nav className="nav-links">
            <a href="#swap">Swap</a>
            <a href="#launchpad">Launchpad</a>
            <a href="#tokens">Tokens</a>
          </nav>
          <div className="nav-spacer" />
          <button
            className="chain-pill"
            onClick={loadChain}
            title={chainError ?? "GIWA Sepolia — click to refresh block height"}
          >
            <span className={`chain-dot${chainError ? " err" : ""}`} />
            <span className="chain-label">GIWA Sepolia</span>
            <span>
              {chainStatus ? `#${chainStatus.blockNumber.toString()}` : chainError ? "offline" : "…"}
            </span>
          </button>
          <WalletConnect wallet={wallet} onChange={setWallet} variant="header" />
        </div>
      </header>

      <main>
        <div className="hero" id="swap">
          <h1 className="hero-title">Swap on GIWA Sepolia</h1>
          <p className="hero-sub">
            Exchange &amp; launchpad powered by the Ammora SDK {SDK_VERSION}. Testnet only — tokens have no value.
          </p>
          <SwapBox wallet={wallet} />
          <WalletConnect wallet={wallet} onChange={setWallet} variant="panel" />
        </div>

        <div className="sections">
          <section className="section" id="launchpad">
            <div className="section-head">
              <h2>Launchpad</h2>
              <p>
                Create a token on a bonding curve, trade it, and graduate it to a concentrated pool — all on the
                Ammora SDK. Chain {CHAIN_ID} (GIWA Sepolia).
              </p>
            </div>
            <Launchpad wallet={wallet} />
          </section>

          <section className="section" id="tokens">
            <div className="section-head">
              <h2>Tokens</h2>
              <p>Recently launched tokens, read live from the launch factory.</p>
            </div>
            <TokenList />
          </section>
        </div>

        <footer>
          <p>
            CuanSwap is a testnet demo for the Ammora Season 2 builder mission. Built with the Ammora SDK on GIWA
            Sepolia. Nothing here is financial advice; testnet tokens have no value. The app never holds a private
            key — every transaction is signed by you in your own wallet.
          </p>
        </footer>
      </main>
    </>
  );
}
