import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { IAudioSource } from "../../domain/interfaces/iaudio.source";

/**
 * S3AudioSource implements IAudioSource for reading audio files from AWS S3.
 * 
 * Example usage:
 * ```typescript
 * const source = new S3AudioSource("my-bucket", "audio/file.wav", {
 *   region: "us-east-1",
 *   credentials: { accessKeyId: "...", secretAccessKey: "..." }
 * });
 * const stream = source.getReadableStream();
 * ```
 */
export class S3AudioSource implements IAudioSource {
  private s3Client: S3Client;
  private bucket: string;
  private key: string;

  constructor(
    bucket: string,
    key: string,
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
    this.bucket = bucket;
    this.key = key;

    // Ensure region is always a string, never undefined or function
    const region = s3Config?.region || "us-east-1";
    if (typeof region !== "string") {
      throw new Error(`Invalid region: must be a string, got ${typeof region}`);
    }

    console.log(`[S3AudioSource] Initializing with region: ${region} for bucket: ${bucket}`);

    this.s3Client = new S3Client({
      region: region,
      credentials: s3Config?.credentials,
      endpoint: s3Config?.endpoint,
      forcePathStyle: s3Config?.forcePathStyle || false,
    });
  }

  getId(): string {
    return `${this.bucket}/${this.key}`;
  }

  getReadableStream(): Readable {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.key,
    });

    const s3Client = this.s3Client;
    const bucket = this.bucket;
    const key = this.key;

    console.log(`[S3AudioSource] Creating stream for ${bucket}/${key}`);

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

        console.log(`[S3AudioSource] Starting S3 request for ${bucket}/${key}`);

        // Start the async S3 request
        s3Client
          .send(command)
          .then((response) => {
            if (!response.Body) {
              const error = new Error(`No body returned from S3 for ${bucket}/${key}`);
              console.error(`[S3AudioSource] Error:`, error.message);
              this.emit("error", error);
              return;
            }

            console.log(`[S3AudioSource] S3 response received, streaming data...`);

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
              console.log(`[S3AudioSource] Stream ended for ${bucket}/${key}`);
              this.push(null); // Signal end of stream
            });

            bodyStream.on("error", (error) => {
              console.error(`[S3AudioSource] Stream error:`, error);
              this.emit("error", error);
            });

            // Resume the S3 stream if it was paused
            if (bodyStream.isPaused()) {
              bodyStream.resume();
            }
          })
          .catch((error) => {
            console.error(`[S3AudioSource] S3 request failed:`, error);
            this.emit("error", error);
          });
      },
    });

    return stream;
  }
}

