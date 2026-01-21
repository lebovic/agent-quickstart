/**
 * Git command builders for container startup.
 * These are pure functions with no side effects, making them easily testable.
 */

const DEFAULT_WORKDIR = "/home/user"

export type GitSource = {
  type: "git_repository"
  url: string
}

export type GitOutcome = {
  type: "git_repository"
  git_info: {
    type: "github"
    repo: string
    branches: string[]
  }
}

export type StartupCommandResult = {
  cloneCommands: string[]
  workDir: string
}

/**
 * Generates a branch name for a session.
 * Format: agent-<random-id>
 */
export function generateBranchName(): string {
  const shortId = Math.random().toString(36).slice(2, 8)
  return `agent-${shortId}`
}

/**
 * Builds the git setup commands: configures git to use our proxy with auth.
 * Creates a credential helper script that reads TOKEN from environment at runtime.
 */
export function buildGitSetupCommands(proxyUrl: string): string[] {
  // Create credential helper script using echo with single quotes.
  // Single quotes prevent $TOKEN from being expanded during script creation,
  // so it remains literal and gets expanded when the script runs.
  const createScript = [
    `echo '#!/bin/sh' > /tmp/git-cred`,
    `echo 'echo username=x-access-token' >> /tmp/git-cred`,
    `echo 'echo "password=$TOKEN"' >> /tmp/git-cred`,
    `chmod +x /tmp/git-cred`,
  ].join(" && ")

  return [
    createScript,
    `git config --global credential.helper /tmp/git-cred`,
    `git config --global push.autoSetupRemote true`,
    `git config --global url."${proxyUrl}/api/git-proxy/".insteadOf "https://github.com/"`,
  ]
}

/**
 * Builds the startup commands to clone git repositories, create branch, and set working directory.
 */
export function buildCloneCommands(sources: GitSource[], outcomes: GitOutcome[]): StartupCommandResult {
  const cloneCommands: string[] = []
  let workDir = DEFAULT_WORKDIR

  const gitSource = sources.find((s) => s.type === "git_repository")

  if (gitSource) {
    // Extract repo name from URL (e.g., https://github.com/owner/repo -> repo)
    const repoName =
      gitSource.url
        .split("/")
        .pop()
        ?.replace(/\.git$/, "") || "repo"
    const cloneDir = `${DEFAULT_WORKDIR}/${repoName}`
    cloneCommands.push(`[ -d ${cloneDir}/.git ] || git clone ${gitSource.url} ${cloneDir}`)
    workDir = cloneDir

    // Find matching outcome to get the branch name
    const outcome = outcomes.find((o) => o.type === "git_repository")
    if (outcome && outcome.git_info.branches.length > 0) {
      const branch = outcome.git_info.branches[0]
      // Checkout branch (create if doesn't exist)
      cloneCommands.push(`cd ${cloneDir} && git checkout ${branch} 2>/dev/null || git checkout -b ${branch}`)
      // Configure git user for commits
      cloneCommands.push(`cd ${cloneDir} && git config user.email "agent@example.com"`)
      cloneCommands.push(`cd ${cloneDir} && git config user.name "Agent"`)
    }
  }

  return { cloneCommands, workDir }
}

export { DEFAULT_WORKDIR }
