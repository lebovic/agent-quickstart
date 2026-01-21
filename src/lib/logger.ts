import pino from "pino"
import { config } from "@/config"

export const log = pino({
  level: config.logLevel,
  ...(process.env.NODE_ENV === "development" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
})
