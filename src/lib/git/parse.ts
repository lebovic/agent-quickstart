/**
 * Parses owner/repo from a repository path.
 *
 * Supported formats:
 * - "owner/repo"
 * - "owner/repo.git"
 * - "/owner/repo"
 * - "/owner/repo.git"
 * - "/owner/repo/info/refs" (git smart HTTP)
 * - "/owner/repo/git-upload-pack" (git smart HTTP)
 * - "/owner/repo/git-receive-pack" (git smart HTTP)
 *
 * Returns null if the path doesn't match expected format.
 */
export function parseRepoFromPath(path: string): { owner: string; repo: string } | null {
  // Remove leading slash
  let cleaned = path.startsWith("/") ? path.slice(1) : path

  // Remove git smart HTTP suffixes
  cleaned = cleaned
    .replace(/\/info\/refs$/, "")
    .replace(/\/git-upload-pack$/, "")
    .replace(/\/git-receive-pack$/, "")

  // Remove .git suffix
  cleaned = cleaned.replace(/\.git$/, "")

  // Split and validate
  const parts = cleaned.split("/")
  if (parts.length !== 2) {
    return null
  }

  const [owner, repo] = parts

  // Validate owner and repo names (GitHub rules)
  // - Must not be empty
  // - Owner: alphanumeric and hyphens, cannot start/end with hyphen
  // - Repo: alphanumeric, hyphens, underscores, periods
  if (!owner || !repo) {
    return null
  }

  const ownerRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/
  const repoRegex = /^[a-zA-Z0-9._-]+$/

  if (!ownerRegex.test(owner) || !repoRegex.test(repo)) {
    return null
  }

  return { owner, repo }
}

/**
 * Parses owner/repo from a full GitHub URL.
 *
 * Supported formats:
 * - "https://github.com/owner/repo"
 * - "https://github.com/owner/repo.git"
 * - "git@github.com:owner/repo.git"
 *
 * Returns null if the URL doesn't match expected format.
 */
export function parseRepoFromUrl(url: string): { owner: string; repo: string } | null {
  // Handle SSH format: git@github.com:owner/repo.git
  if (url.startsWith("git@github.com:")) {
    const path = url.slice("git@github.com:".length)
    return parseRepoFromPath(path)
  }

  // Handle HTTPS format
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== "github.com") {
      return null
    }
    return parseRepoFromPath(parsed.pathname)
  } catch {
    return null
  }
}
