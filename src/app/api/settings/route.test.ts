import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Provider } from "@prisma/client"
import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/crypto/encryption"
import { TEST_USER_ID } from "../../../../vitest.setup"
import { GET, PATCH } from "./route"

describe("GET /api/settings", () => {
  beforeAll(async () => {
    await prisma.user.update({
      where: { id: TEST_USER_ID },
      data: {
        provider: Provider.hosted,
        anthropicApiKeyEnc: null,
        anthropicSessionKeyEnc: null,
        anthropicOrgUuid: null,
      },
    })
  })

  it("returns default settings", async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.provider).toBe("hosted")
    expect(body.anthropicApiKeyMasked).toBeNull()
    expect(body.anthropicSessionKeyMasked).toBeNull()
    expect(body.anthropicOrgUuid).toBeNull()
  })

  it("returns masked API key when set", async () => {
    const apiKey = "sk-ant-api03-test1234567890abcdef"
    await prisma.user.update({
      where: { id: TEST_USER_ID },
      data: {
        provider: Provider.byok,
        anthropicApiKeyEnc: encrypt(apiKey),
      },
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.provider).toBe("byok")
    expect(body.anthropicApiKeyMasked).toBe("sk-ant-api03...cdef")
    expect(body.anthropicSessionKeyMasked).toBeNull()
  })

  it("returns masked session key when set", async () => {
    const sessionKey = "sk-ant-sid01-testsecretkey123"
    await prisma.user.update({
      where: { id: TEST_USER_ID },
      data: {
        provider: Provider.debug,
        anthropicSessionKeyEnc: encrypt(sessionKey),
        anthropicOrgUuid: "test-org-uuid",
      },
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.provider).toBe("debug")
    expect(body.anthropicSessionKeyMasked).toBe("sk-ant-sid01...y123")
    expect(body.anthropicOrgUuid).toBe("test-org-uuid")
  })
})

describe("PATCH /api/settings", () => {
  beforeAll(async () => {
    await prisma.user.update({
      where: { id: TEST_USER_ID },
      data: {
        provider: Provider.hosted,
        anthropicApiKeyEnc: null,
        anthropicSessionKeyEnc: null,
        anthropicOrgUuid: null,
      },
    })
  })

  afterAll(async () => {
    await prisma.user.update({
      where: { id: TEST_USER_ID },
      data: {
        provider: Provider.hosted,
        anthropicApiKeyEnc: null,
        anthropicSessionKeyEnc: null,
        anthropicOrgUuid: null,
      },
    })
  })

  it("updates provider", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "byok" }),
    })

    const response = await PATCH(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.provider).toBe("byok")

    const user = await prisma.user.findUnique({ where: { id: TEST_USER_ID } })
    expect(user?.provider).toBe(Provider.byok)
  })

  it("encrypts and stores API key", async () => {
    const apiKey = "sk-ant-api03-newkey12345678901234"
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: apiKey }),
    })

    const response = await PATCH(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.anthropicApiKeyMasked).toBe("sk-ant-api03...1234")

    const user = await prisma.user.findUnique({ where: { id: TEST_USER_ID } })
    expect(user?.anthropicApiKeyEnc).not.toBeNull()
    expect(decrypt(user!.anthropicApiKeyEnc!)).toBe(apiKey)
  })

  it("encrypts and stores session key", async () => {
    const sessionKey = "sk-ant-sid01-testsessionkey123"
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "debug",
        anthropicSessionKey: sessionKey,
        anthropicOrgUuid: "my-org",
      }),
    })

    const response = await PATCH(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.provider).toBe("debug")
    expect(body.anthropicSessionKeyMasked).toBe("sk-ant-sid01...y123")
    expect(body.anthropicOrgUuid).toBe("my-org")

    const user = await prisma.user.findUnique({ where: { id: TEST_USER_ID } })
    expect(decrypt(user!.anthropicSessionKeyEnc!)).toBe(sessionKey)
  })

  it("clears secret when empty string provided", async () => {
    await prisma.user.update({
      where: { id: TEST_USER_ID },
      data: { anthropicApiKeyEnc: encrypt("some-key") },
    })

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: "" }),
    })

    const response = await PATCH(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.anthropicApiKeyMasked).toBeNull()

    const user = await prisma.user.findUnique({ where: { id: TEST_USER_ID } })
    expect(user?.anthropicApiKeyEnc).toBeNull()
  })

  it("returns 400 for invalid provider", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "invalid" }),
    })

    const response = await PATCH(request)
    expect(response.status).toBe(400)
  })

  it("rejects masked API key placeholder", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: "sk-ant-api03...cdef" }),
    })

    const response = await PATCH(request)
    expect(response.status).toBe(400)
  })

  it("rejects masked session key placeholder", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicSessionKey: "sk-ant-sid01...y123" }),
    })

    const response = await PATCH(request)
    expect(response.status).toBe(400)
  })

  it("only updates provided fields", async () => {
    await prisma.user.update({
      where: { id: TEST_USER_ID },
      data: {
        provider: Provider.debug,
        anthropicOrgUuid: "existing-org",
      },
    })

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "byok" }),
    })

    const response = await PATCH(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.provider).toBe("byok")
    expect(body.anthropicOrgUuid).toBe("existing-org")
  })
})
