/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Ammora SDK ships ESM; keep the default bundling. No Node-only APIs
  // are used in the browser bundle — all chain reads go through viem http().
};

export default nextConfig;
