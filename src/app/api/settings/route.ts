import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { badRequest, unauthorized } from "@/lib/http-errors"
import { getSession } from "@/lib/auth"
import { encrypt, decrypt } from "@/lib/crypto/encryption"
import { UpdateSettingsRequest, maskAnthropicKey } from "@/lib/schemas/settings"

const userSelect = {
  provider: true,
  anthropicApiKeyEnc: true,
  anthropicSessionKeyEnc: true,
  anthropicOrgUuid: true,
}

export async function GET() {
  const authSession = await getSession()
  if (!authSession?.user) return unauthorized()

  const user = await prisma.user.findUnique({
    where: { id: authSession.user.id },
    select: userSelect,
  })

  if (!user) return unauthorized()

  const anthropicApiKey = user.anthropicApiKeyEnc ? decrypt(user.anthropicApiKeyEnc) : null
  const anthropicSessionKey = user.anthropicSessionKeyEnc ? decrypt(user.anthropicSessionKeyEnc) : null

  return NextResponse.json({
    provider: user.provider,
    anthropicApiKeyMasked: maskAnthropicKey(anthropicApiKey),
    anthropicSessionKeyMasked: maskAnthropicKey(anthropicSessionKey),
    anthropicOrgUuid: user.anthropicOrgUuid,
  })
}

export async function PATCH(request: Request) {
  const authSession = await getSession()
  if (!authSession?.user) return unauthorized()

  const body = await request.json()
  const parsed = UpdateSettingsRequest.safeParse(body)

  if (!parsed.success) {
    return badRequest("Invalid request body")
  }

  const { provider, anthropicApiKey, anthropicSessionKey, anthropicOrgUuid } = parsed.data

  // Reject masked placeholder values
  if (anthropicApiKey?.includes("...")) {
    return badRequest("Invalid API key")
  }
  if (anthropicSessionKey?.includes("...")) {
    return badRequest("Invalid session key")
  }

  const user = await prisma.user.update({
    where: { id: authSession.user.id },
    data: {
      ...(provider !== undefined && { provider }),
      ...(anthropicApiKey !== undefined && {
        anthropicApiKeyEnc: anthropicApiKey === "" ? null : encrypt(anthropicApiKey),
      }),
      ...(anthropicSessionKey !== undefined && {
        anthropicSessionKeyEnc: anthropicSessionKey === "" ? null : encrypt(anthropicSessionKey),
      }),
      ...(anthropicOrgUuid !== undefined && {
        anthropicOrgUuid: anthropicOrgUuid === "" ? null : anthropicOrgUuid,
      }),
    },
    select: userSelect,
  })

  const decryptedApiKey = user.anthropicApiKeyEnc ? decrypt(user.anthropicApiKeyEnc) : null
  const decryptedSessionKey = user.anthropicSessionKeyEnc ? decrypt(user.anthropicSessionKeyEnc) : null

  return NextResponse.json({
    provider: user.provider,
    anthropicApiKeyMasked: maskAnthropicKey(decryptedApiKey),
    anthropicSessionKeyMasked: maskAnthropicKey(decryptedSessionKey),
    anthropicOrgUuid: user.anthropicOrgUuid,
  })
}
