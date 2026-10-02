import { S3Client } from "../import.js";
import type { S3Config } from "./s3-storage.gateway.js";

// One place both gateways build their client, so the timeouts cannot be set on one and
// forgotten on the other.
export class S3ClientFactory {
  // Connecting is quick or it is not happening. Past this a stalled archive upload kept
  // its month detached and its job lock renewed forever (`CR.35`).
  private static readonly CONNECTION_TIMEOUT_MS = 5_000;

  // Socket inactivity, not the whole request: a large multipart upload that keeps moving
  // is never cut off, and one that stops is.
  private static readonly REQUEST_TIMEOUT_MS = 60_000;

  private constructor() {}

  public static create(config: S3Config): S3Client {
    return new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      ...(config.checksums === "required"
        ? {
            requestChecksumCalculation: "WHEN_REQUIRED",
            responseChecksumValidation: "WHEN_REQUIRED",
          }
        : {}),
      requestHandler: {
        connectionTimeout: S3ClientFactory.CONNECTION_TIMEOUT_MS,
        requestTimeout: S3ClientFactory.REQUEST_TIMEOUT_MS,
      },
    });
  }
}
