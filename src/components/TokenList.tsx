"use client";

import { useCallback, useState } from "react";
import {
  discoverLaunches,
  explorerAddress,
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
    <div>
      <p className="dim" style={{ fontSize: 14, margin: "0 0 14px" }}>
        Reads <code>LaunchCreated</code> events from the launch factory (last 100,000 blocks, 10k-block chunks — the
        public RPC&apos;s limit), then reads each token&apos;s name / symbol / decimals from chain.
      </p>
      <div className="row" style={{ margin: "0 0 14px" }}>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Scanning…" : "Scan recent launches"}
        </button>
        {scanned && <span className="dim small">{scanned}</span>}
      </div>
      {error && <div className="callout callout-err">{error}</div>}
      {rows.length > 0 && (
        <div className="table-wrap">
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
                    <b>{r.symbol}</b> <span className="dim small">({r.name})</span>
                  </td>
                  <td>
                    <a href={explorerAddress(r.curve)} target="_blank" rel="noreferrer">
                      {shortAddress(r.curve)}
                    </a>
                  </td>
                  <td>
                    #{r.configId.toString()}
                    {r.configId === 6n && (
                      <span className="badge badge-warn" style={{ marginLeft: 8 }}>Blocked</span>
                    )}
                  </td>
                  <td>{r.block.toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dim small" style={{ marginTop: 12 }}>
        Config #6 rows are marked Blocked — that Config is blocked for new launches (graduation bug).
      </p>
    </div>
  );
}
