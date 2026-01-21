import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Externalize native modules that can't be bundled
  serverExternalPackages: ["ssh2", "dockerode", "docker-modem"],
}

export default nextConfig
