import { vi, beforeAll } from "vitest"
import { prisma } from "./src/lib/db"

// Fixed UUIDv4 for test user
export const TEST_USER_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"

// Mock the auth module to avoid Next.js headers() calls in tests
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({
    user: {
      id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      email: "test@example.com",
      name: "Test User",
    },
    session: {
      id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
      userId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    },
  }),
}))

// Mock the provider context module - default to hosted mode
vi.mock("@/lib/auth/provider-context", () => ({
  getUserProviderContext: vi.fn().mockResolvedValue({
    type: "authenticated",
    userId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    provider: { mode: "hosted" },
  }),
}))

// Mock next/headers to avoid "headers was called outside a request scope" errors
vi.mock("next/headers", () => ({
  headers: vi.fn().mockReturnValue(new Headers()),
  cookies: vi.fn().mockReturnValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}))

// Create test user before tests run (ignore if already exists)
beforeAll(async () => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: TEST_USER_ID } })
    if (!existing) {
      await prisma.user.create({
        data: {
          id: TEST_USER_ID,
          email: "test@example.com",
          name: "Test User",
        },
      })
    }
  } catch {
    // User already exists, ignore
  }
})
