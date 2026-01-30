import { config } from "@/config"

export type GitIntegrationMode = "required" | "optional" | "disabled"

export function isGitIntegrationEnabled(): boolean {
  return config.gitIntegrationMode !== "disabled"
}

export function isGitIntegrationRequired(): boolean {
  return config.gitIntegrationMode === "required"
}
