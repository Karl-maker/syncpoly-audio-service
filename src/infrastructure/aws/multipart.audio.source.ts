import { Readable } from "stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { IAudioSource } from "../../domain/interfaces/iaudio.source";
import { AudioFilePart } from "../../domain/entities/audio-file";

/**
 * MultiPartAudioSource implements IAudioSource for reading audio files that are split into multiple parts.
 * It streams parts sequentially, concatenating them into a single readable stream.
 */
export class MultiPartAudioSource implements IAudioSource {
  private s3Client: S3Client;
  private bucket: string;
  private parts: AudioFilePart[];

  constructor(
    bucket: string,
    parts: AudioFilePart[],
    s3Config?: {
      region?: string;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      };
      endpoint?: string;
      forcePathStyle?: boolean;
    }
  ) {
    this.bucket = bucket;
    this.parts = parts.sort((a, b) => a.partIndex - b.partIndex); // Ensure parts are in order

    const region = s3Config?.region || "us-east-1";
    if (typeof region !== "string") {
      throw new Error(`Invalid region: must be a string, got ${typeof region}`);
    }

    this.s3Client = new S3Client({
      region: region,
      credentials: s3Config?.credentials,
      endpoint: s3Config?.endpoint,
      forcePathStyle: s3Config?.forcePathStyle || false,
    });
  }

  getId(): string {
    return `${this.bucket}/${this.parts.map(p => p.s3Key).join(",")}`;
  }

  /**
   * Get a readable stream that concatenates all parts sequentially.
   */
  getReadableStream(): Readable {
    const parts = this.parts;
    const bucket = this.bucket;
    const s3Client = this.s3Client;

    let currentPartIndex = 0;
    let currentStream: Readable | null = null;
    let streamEnded = false;

    const stream = new Readable({
      async read() {
        // If stream has ended, do nothing
        if (streamEnded) {
          return;
        }

        // If we have a current stream, let it handle reading
        if (currentStream) {
          return;
        }

        // If we've processed all parts, end the stream
        if (currentPartIndex >= parts.length) {
          streamEnded = true;
          this.push(null);
          return;
        }

        // Start reading the next part
        const part = parts[currentPartIndex];
        currentPartIndex++;

        try {
          const command = new GetObjectCommand({
            Bucket: bucket,
            Key: part.s3Key,
          });

          const response = await s3Client.send(command);
          if (!response.Body) {
            throw new Error(`No body returned from S3 for part ${part.partIndex}: ${bucket}/${part.s3Key}`);
          }

          currentStream = response.Body as Readable;

          currentStream.on("data", (chunk) => {
            if (!this.push(chunk)) {
              // Backpressure: pause the S3 stream
              currentStream?.pause();
            }
          });

          currentStream.on("end", () => {
            currentStream = null;
            // Continue reading next part
            this.read();
          });

          currentStream.on("error", (error) => {
            this.emit("error", error);
          });

          // Resume if paused
          if (currentStream.isPaused()) {
            currentStream.resume();
          }
        } catch (error: any) {
          this.emit("error", error);
        }
      },
    });

    return stream;
  }

  /**
   * Get a readable stream for a specific part.
   * Useful for processing parts individually.
   */
  getPartStream(partIndex: number): Readable {
    const part = this.parts.find(p => p.partIndex === partIndex);
    if (!part) {
      throw new Error(`Part ${partIndex} not found`);
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: part.s3Key,
    });

    const s3Client = this.s3Client;
    const bucket = this.bucket;
    const key = part.s3Key;

    let s3RequestStarted = false;
    const stream = new Readable({
      read() {
        if (s3RequestStarted) {
          return;
        }
        s3RequestStarted = true;

        s3Client
          .send(command)
          .then((response) => {
            if (!response.Body) {
              const error = new Error(`No body returned from S3 for part ${partIndex}: ${bucket}/${key}`);
              this.emit("error", error);
              return;
            }

            const bodyStream = response.Body as Readable;

            bodyStream.on("data", (chunk) => {
              if (!this.push(chunk)) {
                bodyStream.pause();
              }
            });

            bodyStream.on("end", () => {
              this.push(null);
            });

            bodyStream.on("error", (error) => {
              this.emit("error", error);
            });

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

  /**
   * Get the number of parts.
   */
  getPartCount(): number {
    return this.parts.length;
  }

  /**
   * Get all parts.
   */
  getParts(): AudioFilePart[] {
    return [...this.parts];
  }
}

