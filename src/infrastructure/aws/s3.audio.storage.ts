import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

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
 * Configuration for S3AudioStorage.
 */
export interface S3AudioStorageConfig {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  endpoint?: string; // For S3-compatible services like MinIO
  forcePathStyle?: boolean; // Use path-style addressing (required for some S3-compatible services)
  contentType?: string; // Default: "audio/wav"
  metadata?: Record<string, string>; // Custom metadata to attach to the object
}

/**
 * S3AudioStorage provides functionality to store audio files in AWS S3.
 * 
 * Example usage:
 * ```typescript
 * const storage = new S3AudioStorage({
 *   region: "us-east-1",
 *   credentials: { accessKeyId: "...", secretAccessKey: "..." }
 * });
 * 
 * const audioStream = fs.createReadStream("audio.wav");
 * const s3Uri = await storage.storeAudio(audioStream, "s3://my-bucket/audio/file.wav");
 * ```
 */
export class S3AudioStorage {
  private s3Client: S3Client;
  private defaultContentType: string;

  constructor(config?: S3AudioStorageConfig) {
    this.s3Client = new S3Client({
      region: config?.region || "us-east-1",
      credentials: config?.credentials,
      endpoint: config?.endpoint,
      forcePathStyle: config?.forcePathStyle || false,
    });
    this.defaultContentType = config?.contentType || "audio/wav";
  }

  /**
   * Store an audio file in S3 from a readable stream.
   * 
   * @param audioStream - The audio data as a readable stream
   * @param s3Uri - The S3 URI where the file should be stored (e.g., "s3://bucket/key.wav")
   * @param contentType - Optional content type (defaults to "audio/wav")
   * @param metadata - Optional metadata to attach to the object
   * @returns The S3 URI of the stored file
   */
  async storeAudio(
    audioStream: Readable,
    s3Uri: string,
    options?: {
      contentType?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<string> {
    const { bucket, key } = parseS3Uri(s3Uri);

    // Convert the stream to a buffer for upload
    // Note: For large files, you might want to use multipart upload
    const chunks: Buffer[] = [];
    
    for await (const chunk of audioStream as Readable) {
      const bufferChunk = (globalThis as any).Buffer.isBuffer(chunk) 
        ? chunk 
        : (globalThis as any).Buffer.from(chunk);
      chunks.push(bufferChunk);
    }

    const buffer = (globalThis as any).Buffer.concat(chunks);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: options?.contentType || this.defaultContentType,
      Metadata: options?.metadata,
    });

    try {
      await this.s3Client.send(command);
    } catch (error: any) {
      // Handle region/endpoint errors
      if (error.message?.includes("endpoint") || error.message?.includes("region")) {
        throw new Error(
          `S3 upload failed: ${error.message}. Please verify the bucket region matches the configured region (${this.s3Client.config.region}).`
        );
      }
      throw error;
    }

    return s3Uri;
  }

  /**
   * Store an audio file in S3 from a buffer.
   * 
   * @param audioBuffer - The audio data as a buffer
   * @param s3Uri - The S3 URI where the file should be stored
   * @param options - Optional content type and metadata
   * @returns The S3 URI of the stored file
   */
  async storeAudioFromBuffer(
    audioBuffer: Buffer | Uint8Array,
    s3Uri: string,
    options?: {
      contentType?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<string> {
    const { bucket, key } = parseS3Uri(s3Uri);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: audioBuffer,
      ContentType: options?.contentType || this.defaultContentType,
      Metadata: options?.metadata,
    });

    await this.s3Client.send(command);

    return s3Uri;
  }

  /**
   * Delete an audio file from S3.
   * 
   * @param s3Uri - The S3 URI of the file to delete
   */
  async deleteAudio(s3Uri: string): Promise<void> {
    const { bucket, key } = parseS3Uri(s3Uri);

    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  /**
   * Check if an audio file exists in S3.
   * 
   * @param s3Uri - The S3 URI to check
   * @returns True if the file exists, false otherwise
   */
  async audioExists(s3Uri: string): Promise<boolean> {
    const { bucket, key } = parseS3Uri(s3Uri);

    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      await this.s3Client.send(command);
      return true;
    } catch (error: unknown) {
      const awsError = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (awsError.name === "NotFound" || awsError.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}

