"use client";

import { useCallback, useState } from "react";
import {
  discoverLaunches,
  explorerAddress,
  fmtUnits,
  getPublicClient,
  getTokenMeta,
  shortAddress,
  type DiscoveredLaunch,
} from "../lib/ammora";

interface Row extends DiscoveredLaunch {
  symbol: string;
  name: string;
  decimals: number;
}

export default function TokenList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getPublicClient();
      const launches = await discoverLaunches(client, 100000, 10000);
      const out: Row[] = [];
      for (const l of launches.slice(0, 15)) {
        const meta = await getTokenMeta(client, l.token);
        out.push({ ...l, symbol: meta.symbol, name: meta.name, decimals: meta.decimals });
        // Pace the metadata reads on the shared public RPC.
        await new Promise((r) => setTimeout(r, 200));
      }
      setRows(out);
      setScanned(`${launches.length} launches found in the last 100,000 blocks (showing ${out.length}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <section className="card">
      <h2>4 · Token discovery — recent launches</h2>
      <p className="dim small">
        Reads <code>LaunchCreated</code> events from the launch factory (last 100,000 blocks, 10k-block chunks — the
        public RPC&apos;s limit), then reads each token&apos;s name / symbol / decimals from chain.
      </p>
      <div className="row">
        <button onClick={load} disabled={loading}>
          {loading ? "Scanning…" : "Scan recent launches"}
        </button>
        {scanned && <span className="dim small">{scanned}</span>}
      </div>
      {error && <p className="err">{error}</p>}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Symbol</th>
              <th>Curve</th>
              <th>Config</th>
              <th>Block</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.token}>
                <td>
                  <a href={explorerAddress(r.token)} target="_blank" rel="noreferrer">
                    {shortAddress(r.token)}
                  </a>
                </td>
                <td>
                  {r.symbol} <span className="dim small">({r.name})</span>
                </td>
                <td>
                  <a href={explorerAddress(r.curve)} target="_blank" rel="noreferrer">
                    {shortAddress(r.curve)}
                  </a>
                </td>
                <td>
                  #{r.configId.toString()}
                  {r.configId === 6n ? " ⛔" : ""}
                </td>
                <td>{r.block.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="dim small">
        Config #6 rows are marked ⛔ — that Config is blocked for new launches (graduation bug).
      </p>
    </section>
  );
}
