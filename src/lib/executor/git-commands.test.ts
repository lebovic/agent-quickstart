import { describe, it, expect } from "vitest"
import { buildGitSetupCommands, buildCloneCommands } from "./git-commands"

describe("buildGitSetupCommands", () => {
  const proxyUrl = "http://host.docker.internal:3000"

  it("returns four setup commands", () => {
    const commands = buildGitSetupCommands(proxyUrl)
    expect(commands).toHaveLength(4)
  })

  it("creates credential helper script with TOKEN variable", () => {
    const commands = buildGitSetupCommands(proxyUrl)
    const createScriptCmd = commands[0]

    // Should create script that outputs username and password
    expect(createScriptCmd).toContain("/tmp/git-cred")
    expect(createScriptCmd).toContain("#!/bin/sh")
    expect(createScriptCmd).toContain("username=x-access-token")
    expect(createScriptCmd).toContain("$TOKEN")
    expect(createScriptCmd).toContain("chmod +x")
  })

  it("configures git to use credential helper script", () => {
    const commands = buildGitSetupCommands(proxyUrl)
    expect(commands[1]).toBe("git config --global credential.helper /tmp/git-cred")
  })

  it("configures git to auto-setup remote on push", () => {
    const commands = buildGitSetupCommands(proxyUrl)
    expect(commands[2]).toBe("git config --global push.autoSetupRemote true")
  })

  it("configures git URL rewriting to use proxy", () => {
    const commands = buildGitSetupCommands(proxyUrl)
    const urlRewriteCmd = commands[3]

    expect(urlRewriteCmd).toBe(`git config --global url."${proxyUrl}/api/git-proxy/".insteadOf "https://github.com/"`)
  })

  it("handles different proxy URLs", () => {
    const httpsUrl = "https://proxy.example.com:8443"
    const commands = buildGitSetupCommands(httpsUrl)

    expect(commands[3]).toContain(`${httpsUrl}/api/git-proxy/`)
  })
})

describe("buildCloneCommands", () => {
  const DEFAULT_WORKDIR = "/home/user"

  describe("with no sources", () => {
    it("returns empty clone commands and default workdir", () => {
      const result = buildCloneCommands([], [])
      expect(result.cloneCommands).toEqual([])
      expect(result.workDir).toBe(DEFAULT_WORKDIR)
    })
  })

  describe("with git_repository source", () => {
    it("generates clone command with correct URL and destination", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/owner/my-repo" }]
      const result = buildCloneCommands(sources, [])

      expect(result.cloneCommands).toHaveLength(1)
      expect(result.cloneCommands[0]).toBe(
        `[ -d ${DEFAULT_WORKDIR}/my-repo/.git ] || git clone https://github.com/owner/my-repo ${DEFAULT_WORKDIR}/my-repo`
      )
    })

    it("sets workDir to cloned repository directory", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/owner/my-repo" }]
      const result = buildCloneCommands(sources, [])

      expect(result.workDir).toBe(`${DEFAULT_WORKDIR}/my-repo`)
    })

    it("extracts repo name from URL correctly", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/anthropics/claude-code" }]
      const result = buildCloneCommands(sources, [])

      expect(result.cloneCommands[0]).toContain("/claude-code")
      expect(result.workDir).toBe(`${DEFAULT_WORKDIR}/claude-code`)
    })

    it("handles .git suffix in URL", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/owner/repo.git" }]
      const result = buildCloneCommands(sources, [])

      expect(result.cloneCommands[0]).toContain(`${DEFAULT_WORKDIR}/repo`)
      expect(result.workDir).toBe(`${DEFAULT_WORKDIR}/repo`)
    })

    it("handles repo names with hyphens", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/owner/my-awesome-repo" }]
      const result = buildCloneCommands(sources, [])

      expect(result.workDir).toBe(`${DEFAULT_WORKDIR}/my-awesome-repo`)
    })

    it("handles repo names with underscores", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/owner/my_repo" }]
      const result = buildCloneCommands(sources, [])

      expect(result.workDir).toBe(`${DEFAULT_WORKDIR}/my_repo`)
    })
  })

  describe("with outcomes (branch creation)", () => {
    it("creates and checks out branch from outcome", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/owner/repo" }]
      const outcomes = [
        {
          type: "git_repository" as const,
          git_info: { type: "github" as const, repo: "owner/repo", branches: ["agent-abc123"] },
        },
      ]
      const result = buildCloneCommands(sources, outcomes)

      expect(result.cloneCommands).toHaveLength(4) // clone, checkout, config email, config name
      expect(result.cloneCommands[1]).toContain("git checkout -b agent-abc123")
    })

    it("configures git user for commits", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/owner/repo" }]
      const outcomes = [
        {
          type: "git_repository" as const,
          git_info: { type: "github" as const, repo: "owner/repo", branches: ["agent-abc123"] },
        },
      ]
      const result = buildCloneCommands(sources, outcomes)

      expect(result.cloneCommands[2]).toContain('git config user.email "agent@example.com"')
      expect(result.cloneCommands[3]).toContain('git config user.name "Agent"')
    })
  })

  describe("with multiple sources", () => {
    it("only clones the first git_repository source", () => {
      const sources = [
        { type: "git_repository" as const, url: "https://github.com/owner/first-repo" },
        { type: "git_repository" as const, url: "https://github.com/owner/second-repo" },
      ]
      const result = buildCloneCommands(sources, [])

      // Currently only clones first one (uses find())
      expect(result.cloneCommands).toHaveLength(1)
      expect(result.cloneCommands[0]).toContain("first-repo")
      expect(result.workDir).toBe(`${DEFAULT_WORKDIR}/first-repo`)
    })
  })

  describe("edge cases", () => {
    it("handles empty URL path gracefully", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/" }]
      const result = buildCloneCommands(sources, [])

      // Should fallback to "repo" when URL parsing fails
      expect(result.cloneCommands).toHaveLength(1)
    })

    it("handles URL with trailing slash", () => {
      const sources = [{ type: "git_repository" as const, url: "https://github.com/owner/repo/" }]
      const result = buildCloneCommands(sources, [])

      // Trailing empty segment means split().pop() returns ""
      // Should handle this edge case
      expect(result.cloneCommands).toHaveLength(1)
    })
  })
})
