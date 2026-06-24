// SPDX-License-Identifier: Apache-2.0

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The SDK ships as TypeScript ESM in this workspace; let Next transpile it.
  transpilePackages: ["@sidereal/sdk"],
};

export default nextConfig;
