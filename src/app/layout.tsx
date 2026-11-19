import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CuanSwap — Ammora on GIWA Sepolia Testnet",
  description:
    "Minimal exchange + launchpad built with the Ammora SDK 0.3.9 on GIWA Sepolia testnet. Test ETH only — $0 value, no mainnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
