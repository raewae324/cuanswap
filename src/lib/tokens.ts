// Tokens verified live on GIWA Sepolia (2026-11-19). Quotes for both pairs
// were verified against the live RPC before this list was written.
import { WETH, type Address } from "./ammora";
import type { AmmoraSwapModel } from "@ammora-protocol/sdk";

export interface KnownPair {
  id: string;
  label: string;
  model: AmmoraSwapModel;
  /** Pool / curve address the route client routes through. */
  pool: Address;
  tokenA: { address: Address; symbol: string; decimals: number };
  tokenB: { address: Address; symbol: string; decimals: number };
  /** Lifecycle of the pool at the time it was verified. */
  note: string;
}

export const WETH_TOKEN = { address: WETH, symbol: "WETH", decimals: 18 };

export const KNOWN_PAIRS: KnownPair[] = [
  {
    id: "att-dbc",
    label: "WETH ↔ ATT (bonding curve)",
    model: "dbc",
    pool: "0xD9ea635D7b80666A475FBCABd45A258637a3B180",
    tokenA: WETH_TOKEN,
    tokenB: { address: "0xadB43dfDCDD78546912FB988D0D5E477926031a5", symbol: "ATT", decimals: 9 },
    note: "Ammora Test Token — active pre-graduation curve (Config #56). 0.01 WETH quoted live.",
  },
  {
    id: "lodos-concentrated",
    label: "WETH ↔ LODOS (graduated pool)",
    model: "concentrated",
    pool: "0x220FFcc366deC58bFBc48589a2eE9457c0fc46Eb",
    tokenA: WETH_TOKEN,
    tokenB: { address: "0xfB972A93CEf268D96949DF380a85FC0244e1fa8E", symbol: "LODOS", decimals: 9 },
    note: "LODOs — graduated + migrated to a concentrated ARL pool. 0.01 WETH quoted live (price impact 151 bps).",
  },
];

/** The dbc curve behind the ATT pair (used for the curve-state / graduation panel). */
export const ATT_CURVE: Address = "0xD9ea635D7b80666A475FBCABd45A258637a3B180";
/** The migrated LODOS pool. */
export const LODOS_POOL: Address = "0x220FFcc366deC58bFBc48589a2eE9457c0fc46Eb";
