import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Externalize native modules that can't be bundled
  serverExternalPackages: ["ssh2", "dockerode", "docker-modem"],
  experimental: {
    // When using proxies/middleware in Next.js, the request body is cloned and stored in memory
    // This poses a problem for proxying file uploads
    // TODO: figure out a better pattern here for larger files and requests
    proxyClientMaxBodySize: "50mb",
  },
}

export default nextConfig
