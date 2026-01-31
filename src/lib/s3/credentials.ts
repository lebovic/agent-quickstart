import { AssumeRoleCommand } from "@aws-sdk/client-sts"
import { getSTSClient } from "./client"
import { config } from "@/config"
import { log } from "@/lib/logger"

export interface SessionS3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration: Date
}

/**
 * Generate STS credentials scoped to a specific session's S3 prefix.
 * The credentials can only access s3://{bucket}/sessions/{sessionId}/*
 */
export async function generateSessionS3Credentials(sessionId: string): Promise<SessionS3Credentials> {
  if (!config.sessionFiles) {
    throw new Error("Session files not configured")
  }

  const { bucket, roleArn } = config.sessionFiles

  // Inline session policy to scope credentials to this session's prefix only
  const sessionPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: `arn:aws:s3:::${bucket}`,
        Condition: {
          StringLike: { "s3:prefix": `sessions/${sessionId}/*` },
        },
      },
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
        Resource: `arn:aws:s3:::${bucket}/sessions/${sessionId}/*`,
      },
    ],
  })

  const sts = getSTSClient()
  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: `session-${sessionId.slice(0, 8)}`,
    DurationSeconds: 3600, // 1 hour, matches Modal sandbox timeout
    Policy: sessionPolicy,
  })

  log.debug({ sessionId }, "Generating STS credentials for session")

  const response = await sts.send(command)

  if (!response.Credentials) {
    throw new Error("Failed to get STS credentials")
  }

  const { AccessKeyId, SecretAccessKey, SessionToken, Expiration } = response.Credentials

  if (!AccessKeyId || !SecretAccessKey || !SessionToken || !Expiration) {
    throw new Error("Incomplete STS credentials response")
  }

  log.debug({ sessionId, expiration: Expiration.toISOString() }, "Generated STS credentials for session")

  return {
    accessKeyId: AccessKeyId,
    secretAccessKey: SecretAccessKey,
    sessionToken: SessionToken,
    expiration: Expiration,
  }
}
