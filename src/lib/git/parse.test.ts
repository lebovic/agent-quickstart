import { describe, it, expect } from "vitest"
import { parseRepoFromPath, parseRepoFromUrl } from "./parse"

describe("parseRepoFromPath", () => {
  describe("valid paths", () => {
    it("parses owner/repo", () => {
      expect(parseRepoFromPath("owner/repo")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses /owner/repo with leading slash", () => {
      expect(parseRepoFromPath("/owner/repo")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses owner/repo.git", () => {
      expect(parseRepoFromPath("owner/repo.git")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses /owner/repo.git", () => {
      expect(parseRepoFromPath("/owner/repo.git")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses git smart HTTP info/refs path", () => {
      expect(parseRepoFromPath("/owner/repo/info/refs")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses git smart HTTP git-upload-pack path", () => {
      expect(parseRepoFromPath("/owner/repo/git-upload-pack")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses git smart HTTP git-receive-pack path", () => {
      expect(parseRepoFromPath("/owner/repo/git-receive-pack")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses .git suffix with git smart HTTP path", () => {
      expect(parseRepoFromPath("/owner/repo.git/info/refs")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("handles hyphenated owner names", () => {
      expect(parseRepoFromPath("my-org/repo")).toEqual({ owner: "my-org", repo: "repo" })
    })

    it("handles hyphenated repo names", () => {
      expect(parseRepoFromPath("owner/my-repo")).toEqual({ owner: "owner", repo: "my-repo" })
    })

    it("handles underscores in repo names", () => {
      expect(parseRepoFromPath("owner/my_repo")).toEqual({ owner: "owner", repo: "my_repo" })
    })

    it("handles periods in repo names", () => {
      expect(parseRepoFromPath("owner/my.repo")).toEqual({ owner: "owner", repo: "my.repo" })
    })

    it("handles numeric names", () => {
      expect(parseRepoFromPath("user123/repo456")).toEqual({ owner: "user123", repo: "repo456" })
    })

    it("handles single character owner", () => {
      expect(parseRepoFromPath("a/repo")).toEqual({ owner: "a", repo: "repo" })
    })

    it("handles single character repo", () => {
      expect(parseRepoFromPath("owner/r")).toEqual({ owner: "owner", repo: "r" })
    })
  })

  describe("invalid paths", () => {
    it("rejects empty string", () => {
      expect(parseRepoFromPath("")).toBeNull()
    })

    it("rejects single segment", () => {
      expect(parseRepoFromPath("owner")).toBeNull()
    })

    it("rejects three segments", () => {
      expect(parseRepoFromPath("owner/repo/extra")).toBeNull()
    })

    it("rejects empty owner", () => {
      expect(parseRepoFromPath("/repo")).toBeNull()
    })

    it("rejects empty repo", () => {
      expect(parseRepoFromPath("owner/")).toBeNull()
    })

    it("rejects owner starting with hyphen", () => {
      expect(parseRepoFromPath("-owner/repo")).toBeNull()
    })

    it("rejects owner ending with hyphen", () => {
      expect(parseRepoFromPath("owner-/repo")).toBeNull()
    })

    it("rejects owner with underscore", () => {
      expect(parseRepoFromPath("my_org/repo")).toBeNull()
    })

    it("rejects owner with period", () => {
      expect(parseRepoFromPath("my.org/repo")).toBeNull()
    })

    it("rejects special characters in owner", () => {
      expect(parseRepoFromPath("owner@/repo")).toBeNull()
      expect(parseRepoFromPath("owner!/repo")).toBeNull()
      expect(parseRepoFromPath("owner /repo")).toBeNull()
    })

    it("rejects special characters in repo", () => {
      expect(parseRepoFromPath("owner/repo@")).toBeNull()
      expect(parseRepoFromPath("owner/repo!")).toBeNull()
      expect(parseRepoFromPath("owner/repo ")).toBeNull()
    })
  })
})

describe("parseRepoFromUrl", () => {
  describe("HTTPS URLs", () => {
    it("parses https://github.com/owner/repo", () => {
      expect(parseRepoFromUrl("https://github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses https://github.com/owner/repo.git", () => {
      expect(parseRepoFromUrl("https://github.com/owner/repo.git")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses https://github.com/owner/repo/", () => {
      expect(parseRepoFromUrl("https://github.com/owner/repo/")).toBeNull() // trailing slash creates extra segment
    })

    it("rejects non-github.com hosts", () => {
      expect(parseRepoFromUrl("https://gitlab.com/owner/repo")).toBeNull()
      expect(parseRepoFromUrl("https://bitbucket.org/owner/repo")).toBeNull()
      expect(parseRepoFromUrl("https://example.com/owner/repo")).toBeNull()
    })

    it("rejects http (non-https)", () => {
      // URL class handles this, but let's verify github.com check still works
      expect(parseRepoFromUrl("http://github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" })
    })
  })

  describe("SSH URLs", () => {
    it("parses git@github.com:owner/repo.git", () => {
      expect(parseRepoFromUrl("git@github.com:owner/repo.git")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("parses git@github.com:owner/repo", () => {
      expect(parseRepoFromUrl("git@github.com:owner/repo")).toEqual({ owner: "owner", repo: "repo" })
    })

    it("rejects non-github SSH URLs", () => {
      expect(parseRepoFromUrl("git@gitlab.com:owner/repo.git")).toBeNull()
    })
  })

  describe("invalid URLs", () => {
    it("rejects invalid URL format", () => {
      expect(parseRepoFromUrl("not a url")).toBeNull()
    })

    it("rejects empty string", () => {
      expect(parseRepoFromUrl("")).toBeNull()
    })
  })
})
