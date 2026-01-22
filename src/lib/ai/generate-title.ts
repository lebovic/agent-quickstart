import { config } from "@/config"
import { log } from "@/lib/logger"

/** Maximum length for generated titles before falling back to truncation */
const MAX_TITLE_LENGTH = 200

/** Timeout for title generation API call in milliseconds */
const GENERATION_TIMEOUT_MS = 5000

/** Maximum prompt length to send to the API */
const MAX_PROMPT_LENGTH = 500

function buildPrompt(userRequest: string): string {
  return `Generate a concise title (5-10 words) for this coding session based on the user's request. Return ONLY the title, no quotes or explanation.

User request: ${userRequest}`
}

function createFallbackTitle(prompt: string): string {
  return prompt.slice(0, 100) + (prompt.length > 100 ? "..." : "")
}

export async function generateSessionTitle(prompt: string): Promise<string> {
  if (!config.anthropicApiKey) {
    return createFallbackTitle(prompt)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS)

  try {
    const response = await fetch(`${config.anthropicApiUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: buildPrompt(prompt.slice(0, MAX_PROMPT_LENGTH)),
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      log.warn({ status: response.status }, "Title generation failed")
      return createFallbackTitle(prompt)
    }

    const data = await response.json()
    const title = data.content?.[0]?.text?.trim()

    if (typeof title === "string" && title.length > 0 && title.length < MAX_TITLE_LENGTH) {
      return title
    }
    return createFallbackTitle(prompt)
  } catch (error) {
    log.warn({ error }, "Title generation error")
    return createFallbackTitle(prompt)
  } finally {
    clearTimeout(timeoutId)
  }
}
