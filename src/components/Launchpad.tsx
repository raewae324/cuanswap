"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BLOCKED_CONFIG_ID,
  CHAIN_ID,
  CURVE_STATUS_LABEL,
  DEFAULT_CONFIG_ID,
  DEFAULT_GRADUATION_TARGET_WETH,
  GIWA_SEPOLIA,
  buildCreateLaunchPreview,
  explorerAddress,
  explorerTx,
  fmtUnits,
  getPublicClient,
  getWalletClient,
  listConfigs,
  readConfig,
  readCurveState,
  shortAddress,
  type ConfigSummary,
  type CreateLaunchPreview,
} from "../lib/ammora";
import { ATT_CURVE } from "../lib/tokens";
import type { WalletState } from "./WalletConnect";
import { resolveAmmoraFinalizedHead, giwaSepoliaAutoRoute } from "@ammora-protocol/sdk";

const STEPS = [
  "Config — reusable, immutable: supply, curve, fees, graduation, LP allocation.",
  "Issue token — createLaunch creates a new token + pre-graduation ALC curve together.",
  "Trade on ALC — buy / sell on the bonding curve until the graduation threshold is hit.",
  "Graduation — final buy → ReadyToMigrate, then a separate migration tx → post-graduation ARL concentrated pool.",
  "Claim fees — Creator and Partner claim separately from the FeeVault; LP NFT owner claims LP fees.",
];

export default function Launchpad({ wallet }: { wallet: WalletState }) {
  const [configs, setConfigs] = useState<ConfigSummary[]>([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [configsError, setConfigsError] = useState<string | null>(null);
  const [configIdInput, setConfigIdInput] = useState("7");
  const [configDetail, setConfigDetail] = useState<string | null>(null);

  const [name, setName] = useState("Cuan Token");
  const [symbol, setSymbol] = useState("CUAN");
  const [metadataURI, setMetadataURI] = useState("ipfs://example/cuan-metadata.json");
  const [createConfigId, setCreateConfigId] = useState(String(DEFAULT_CONFIG_ID));
  const [preview, setPreview] = useState<CreateLaunchPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendTx, setSendTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [curveAddr, setCurveAddr] = useState<string>(ATT_CURVE);
  const [curveState, setCurveState] = useState<{
    status: number;
    baseToken: string;
    quoteToken: string;
    quoteReserve: bigint;
    migrationQuoteThreshold: bigint;
    configId: bigint;
  } | null>(null);
  const [curveBusy, setCurveBusy] = useState(false);
  const [curveError, setCurveError] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    setConfigsLoading(true);
    setConfigsError(null);
    try {
      const client = getPublicClient();
      setConfigs(await listConfigs(client, 10));
    } catch (e) {
      setConfigsError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfigsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const readOneConfig = useCallback(async () => {
    setConfigDetail(null);
    setError(null);
    try {
      const id = BigInt(configIdInput);
      const client = getPublicClient();
      const head = await resolveAmmoraFinalizedHead([client], giwaSepoliaAutoRoute.finality);
      const c = await readConfig(client, id, head);
      setConfigDetail(
        [
          `Config #${c.configId} — ${c.enabled ? "enabled" : "DISABLED"}`,
          `hash ${c.configHash}`,
          `owner ${c.identity.owner}`,
          `quote token ${c.config.quoteToken}`,
          `total supply ${fmtUnits(c.config.totalSupply, c.config.tokenDecimals)} (decimals ${c.config.tokenDecimals})`,
          `cliff fee ${c.config.cliffFeeBps} bps · creator share ${c.config.creatorShareOfNonProtocolBps} bps`,
          `migration quote threshold ${fmtUnits(c.config.migrationQuoteThreshold, 18)} WETH · base threshold ${c.config.migrationBaseThreshold}`,
          `migration mode ${c.config.migrationMode} · segments ${c.segments.length}`,
          c.configId === BLOCKED_CONFIG_ID ? "⛔ Config #6 is BLOCKED for new launches." : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [configIdInput]);

  const buildPreview = useCallback(async () => {
    setError(null);
    setPreview(null);
    setSendTx(null);
    if (!name.trim() || !symbol.trim() || !metadataURI.trim()) {
      setError("Fill in the token name, symbol and metadata URI.");
      return;
    }
    let configId: bigint;
    try {
      configId = BigInt(createConfigId);
    } catch {
      setError("Config ID must be a number.");
      return;
    }
    if (configId === BLOCKED_CONFIG_ID) {
      setError("Config #6 is blocked for new launches (graduation bug). Pick another Config.");
      return;
    }
    setPreviewBusy(true);
    try {
      setPreview(await buildCreateLaunchPreview({ name: name.trim(), symbol: symbol.trim().toUpperCase(), metadataURI: metadataURI.trim(), configId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  }, [name, symbol, metadataURI, createConfigId]);

  const sendCreate = useCallback(async () => {
    setError(null);
    if (!preview) return;
    if (!wallet.address) {
      setError("Connect your wallet first — the createLaunch is signed by you in MetaMask/Rabby.");
      return;
    }
    if (wallet.chainId !== CHAIN_ID) {
      setError("Wrong chain — switch to GIWA Sepolia 91342 first.");
      return;
    }
    setSendBusy(true);
    try {
      const wc = await getWalletClient();
      // You confirm this in your own wallet. Nothing is auto-sent.
      const hash = await wc.sendTransaction({
        account: wallet.address,
        chain: GIWA_SEPOLIA,
        to: preview.to,
        data: preview.data,
        value: preview.value,
      });
      setSendTx(hash);
      const client = getPublicClient();
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`createLaunch transaction reverted: ${hash}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSendBusy(false);
    }
  }, [preview, wallet]);

  const readCurve = useCallback(async () => {
    setCurveError(null);
    setCurveState(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(curveAddr)) {
      setCurveError("Enter a valid curve address.");
      return;
    }
    setCurveBusy(true);
    try {
      const client = getPublicClient();
      const s = await readCurveState(client, curveAddr as `0x${string}`);
      setCurveState({
        status: s.status,
        baseToken: s.baseToken,
        quoteToken: s.quoteToken,
        quoteReserve: s.quoteReserve,
        migrationQuoteThreshold: s.migrationQuoteThreshold,
        configId: s.configId,
      });
    } catch (e) {
      setCurveError(e instanceof Error ? e.message : String(e));
    } finally {
      setCurveBusy(false);
    }
  }, [curveAddr]);

  const progress =
    curveState && curveState.migrationQuoteThreshold > 0n
      ? Number((curveState.quoteReserve * 10000n) / curveState.migrationQuoteThreshold) / 100
      : null;

  return (
    <section className="card">
      <h2>3 · Launchpad — Config → issue → trade → graduation</h2>
      <ol className="small">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <h3>Configs (read from chain)</h3>
      <div className="row">
        <button onClick={loadConfigs} disabled={configsLoading}>
          {configsLoading ? "Reading…" : "Refresh Configs"}
        </button>
        <span className="dim small">
          Config #6 is blocked (graduation bug, disabled on-chain) and is never offered for new launches.
        </span>
      </div>
      {configsError && <p className="err">{configsError}</p>}
      {configs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Enabled</th>
              <th>Quote token</th>
              <th>Migration</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.configId.toString()} className={c.configId === BLOCKED_CONFIG_ID ? "blocked" : ""}>
                <td>{c.configId.toString()}</td>
                <td>{c.enabled ? "yes" : "NO"}</td>
                <td>{shortAddress(c.quoteToken)}</td>
                <td>{c.migrationMode}</td>
                <td>{shortAddress(c.owner)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <label>
          Read a Config by ID:{" "}
          <input value={configIdInput} onChange={(e) => setConfigIdInput(e.target.value)} style={{ width: 70 }} />
        </label>
        <button onClick={readOneConfig}>Read Config</button>
      </div>
      {configDetail && <pre>{configDetail}</pre>}

      <h3>Create-token preview (does NOT broadcast)</h3>
      <div className="grid2">
        <label>
          Token name: <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Token symbol: <input value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </label>
        <label>
          Metadata URI: <input value={metadataURI} onChange={(e) => setMetadataURI(e.target.value)} />
        </label>
        <label>
          Config ID to use:{" "}
          <input value={createConfigId} onChange={(e) => setCreateConfigId(e.target.value)} style={{ width: 80 }} />
          <span className="dim small"> (default {DEFAULT_CONFIG_ID.toString()}; #6 blocked)</span>
        </label>
      </div>
      <p className="dim small">
        Default graduation target: {DEFAULT_GRADUATION_TARGET_WETH} WETH net quote reserve. Creating a real token
        needs the Creator wallet to sign createLaunch with GIWA test ETH for gas — that send step is a separate,
        explicit button below, confirmed by you in your wallet.
      </p>
      <div className="row">
        <button onClick={buildPreview} disabled={previewBusy}>
          {previewBusy ? "Building preview…" : "Build preview"}
        </button>
      </div>
      {preview && (
        <div className="quote">
          <p>
            <b>Preview — nothing broadcast yet.</b>
          </p>
          <p>
            To (launch factory): <code>{shortAddress(preview.to)}</code>
          </p>
          <p>
            Config #{preview.configId.toString()} · hash <code>{shortAddress(preview.configHash)}</code>
          </p>
          <p>
            Pool creation fee: {fmtUnits(preview.poolCreationFee, 18)} ETH · token decimals: {preview.tokenDecimals}
          </p>
          <p>
            Value: {fmtUnits(preview.value, 18)} ETH · calldata: {preview.data.length / 2 - 1} bytes
          </p>
          <div className="row">
            <button onClick={sendCreate} disabled={sendBusy || !wallet.address}>
              {sendBusy ? "Waiting for your wallet…" : "Sign & send createLaunch (you confirm in wallet)"}
            </button>
            {!wallet.address && <span className="dim small">Connect a wallet above to send.</span>}
          </div>
          {sendTx && (
            <p className="ok">
              createLaunch sent:{" "}
              <a href={explorerTx(sendTx)} target="_blank" rel="noreferrer">
                {shortAddress(sendTx)}
              </a>
            </p>
          )}
        </div>
      )}

      <h3>Graduation progress (read a curve)</h3>
      <div className="row">
        <label>
          Curve address:{" "}
          <input value={curveAddr} onChange={(e) => setCurveAddr(e.target.value)} style={{ width: 380 }} />
        </label>
        <button onClick={readCurve} disabled={curveBusy}>
          {curveBusy ? "Reading…" : "Read curve"}
        </button>
      </div>
      {curveError && <p className="err">{curveError}</p>}
      {curveState && (
        <div className="quote">
          <p>
            Status: <b>{CURVE_STATUS_LABEL[curveState.status] ?? `status ${curveState.status}`}</b> · Config #
            {curveState.configId.toString()}
          </p>
          <p>
            Base: <code>{shortAddress(curveState.baseToken)}</code> · Quote:{" "}
            <code>{shortAddress(curveState.quoteToken)}</code>
          </p>
          <p>
            Quote reserve: {fmtUnits(curveState.quoteReserve, 18)} WETH / threshold{" "}
            {fmtUnits(curveState.migrationQuoteThreshold, 18)} WETH
            {progress !== null && ` — ${progress.toFixed(2)}%`}
          </p>
          <div className="bar">
            <div style={{ width: `${Math.min(100, progress ?? 0)}%` }} />
          </div>
          <p className="dim small">
            Progress is quoteReserve ÷ the Config&apos;s migrationQuoteThreshold. Default graduation target for new
            launches: {DEFAULT_GRADUATION_TARGET_WETH} WETH net quote reserve.
          </p>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </section>
  );
}
