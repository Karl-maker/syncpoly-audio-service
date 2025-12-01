import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { IAudioSource } from "../../domain/interfaces/iaudio.source";

/**
 * Parses an S3 URI (s3://bucket/key) into bucket and key components.
 */
function parseS3Uri(uri: string): { bucket: string; key: string } {
  if (!uri.startsWith("s3://")) {
    throw new Error(`Invalid S3 URI: ${uri}. Must start with "s3://"`);
  }

  const withoutProtocol = uri.slice(5); // Remove "s3://"
  const firstSlash = withoutProtocol.indexOf("/");

  if (firstSlash === -1) {
    throw new Error(`Invalid S3 URI: ${uri}. Must include a key after bucket name`);
  }

  const bucket = withoutProtocol.slice(0, firstSlash);
  const key = withoutProtocol.slice(firstSlash + 1);

  if (!bucket || !key) {
    throw new Error(`Invalid S3 URI: ${uri}. Bucket and key must be non-empty`);
  }

  return { bucket, key };
}

/**
 * S3AudioSource implements IAudioSource for reading audio files from AWS S3.
 * 
 * Example usage:
 * ```typescript
 * const source = new S3AudioSource("s3://my-bucket/audio/file.wav", {
 *   region: "us-east-1",
 *   credentials: { accessKeyId: "...", secretAccessKey: "..." }
 * });
 * const stream = source.getReadableStream();
 * ```
 */
export class S3AudioSource implements IAudioSource {
  private s3Uri: string;
  private s3Client: S3Client;
  private bucket: string;
  private key: string;

  constructor(
    s3Uri: string,
    s3Config?: {
      region?: string;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      };
      endpoint?: string; // For S3-compatible services like MinIO
      forcePathStyle?: boolean; // Use path-style addressing
    }
  ) {
    this.s3Uri = s3Uri;
    const parsed = parseS3Uri(s3Uri);
    this.bucket = parsed.bucket;
    this.key = parsed.key;

    this.s3Client = new S3Client({
      region: s3Config?.region || "us-east-1",
      credentials: s3Config?.credentials,
      endpoint: s3Config?.endpoint,
      forcePathStyle: s3Config?.forcePathStyle || false,
    });
  }

  getId(): string {
    return this.s3Uri;
  }

  getReadableStream(): Readable {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.key,
    });

    const s3Client = this.s3Client;
    const s3Uri = this.s3Uri;

    // Create a readable stream that will fetch the S3 object asynchronously
    // when it's first read. This allows us to return a stream synchronously
    // while deferring the actual S3 request.
    let s3RequestStarted = false;
    const stream = new Readable({
      read() {
        // Only start the S3 request once, on first read
        if (s3RequestStarted) {
          return;
        }
        s3RequestStarted = true;

        // Start the async S3 request
        s3Client
          .send(command)
          .then((response) => {
            if (!response.Body) {
              this.emit("error", new Error(`No body returned from S3 for ${s3Uri}`));
              return;
            }

            // Convert the response body to a stream
            const bodyStream = response.Body as Readable;

            // Pipe the S3 stream to our readable stream
            bodyStream.on("data", (chunk) => {
              if (!this.push(chunk)) {
                // If push returns false, the stream is backpressured
                bodyStream.pause();
              }
            });

            bodyStream.on("end", () => {
              this.push(null); // Signal end of stream
            });

            bodyStream.on("error", (error) => {
              this.emit("error", error);
            });

            // Resume the S3 stream if it was paused
            if (bodyStream.isPaused()) {
              bodyStream.resume();
            }
          })
          .catch((error) => {
            this.emit("error", error);
          });
      },
    });

    return stream;
  }
}

