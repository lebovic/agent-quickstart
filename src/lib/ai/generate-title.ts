import Anthropic from "@anthropic-ai/sdk"
import { config } from "@/config"
import { log } from "@/lib/logger"

/** Maximum length for generated titles before falling back to truncation */
const MAX_TITLE_LENGTH = 200

/** Timeout for title generation API call in milliseconds */
const GENERATION_TIMEOUT_MS = 5000

/** Maximum prompt length to send to the API */
const MAX_PROMPT_LENGTH = 500

function buildPrompt(userRequest: string): string {
  return `Generate a concise title (5-10 words) for this coding session based on the user's request. Use sentence case (only capitalize the first word and proper nouns). Return ONLY the title, no quotes or explanation.

User request: ${userRequest}`
}

function createFallbackTitle(prompt: string): string {
  return prompt.slice(0, 100) + (prompt.length > 100 ? "..." : "")
}

export async function generateSessionTitle(prompt: string): Promise<string> {
  if (!config.anthropicApiKey) {
    return createFallbackTitle(prompt)
  }

  const client = new Anthropic({
    apiKey: config.anthropicApiKey,
    baseURL: config.anthropicApiUrl,
    timeout: GENERATION_TIMEOUT_MS,
  })

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: buildPrompt(prompt.slice(0, MAX_PROMPT_LENGTH)),
        },
      ],
    })

    const firstBlock = message.content[0]
    if (firstBlock.type === "text") {
      const title = firstBlock.text.trim()
      if (title.length > 0 && title.length < MAX_TITLE_LENGTH) {
        return title
      }
    }
    return createFallbackTitle(prompt)
  } catch (error) {
    log.warn({ error }, "Title generation error")
    return createFallbackTitle(prompt)
  }
}
