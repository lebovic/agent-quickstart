import { S3Client } from "@aws-sdk/client-s3"
import { STSClient } from "@aws-sdk/client-sts"
import { config } from "@/config"

let s3Client: S3Client | null = null
let stsClient: STSClient | null = null

export function getS3Client(): S3Client {
  if (!config.sessionFiles) {
    throw new Error("Session files not configured")
  }
  if (!s3Client) {
    s3Client = new S3Client({ region: config.sessionFiles.region })
  }
  return s3Client
}

export function getSTSClient(): STSClient {
  if (!config.sessionFiles) {
    throw new Error("Session files not configured")
  }
  if (!stsClient) {
    stsClient = new STSClient({ region: config.sessionFiles.region })
  }
  return stsClient
}
