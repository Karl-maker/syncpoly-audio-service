import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

// Multipart upload threshold: use multipart for files larger than 5MB
const MULTIPART_UPLOAD_THRESHOLD = 5 * 1024 * 1024; // 5MB
const MULTIPART_PART_SIZE = 5 * 1024 * 1024; // 5MB per part

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
    // Ensure region is always a string, never undefined or function
    const region = config?.region || "us-east-1";
    if (typeof region !== "string") {
      throw new Error(`Invalid region: must be a string, got ${typeof region}`);
    }

    console.log(`[S3AudioStorage] Initializing with region: ${region}`);

    this.s3Client = new S3Client({
      region: region,
      credentials: config?.credentials,
      endpoint: config?.endpoint,
      forcePathStyle: config?.forcePathStyle || false,
    });
    this.defaultContentType = config?.contentType || "audio/wav";
  }

  /**
   * Store an audio file in S3 from a readable stream using multipart upload for large files.
   * 
   * @param audioStream - The audio data as a readable stream
   * @param bucket - S3 bucket name
   * @param key - S3 object key
   * @param options - Optional content type, metadata, and progress callback
   * @returns Object with bucket and key
   */
  async storeAudio(
    audioStream: Readable,
    bucket: string,
    key: string,
    options?: {
      contentType?: string;
      metadata?: Record<string, string>;
      onProgress?: (progress: number) => void; // Progress callback (0-100)
    }
  ): Promise<{ bucket: string; key: string }> {
    // Collect stream data to determine size
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream as Readable) {
      const bufferChunk = (globalThis as any).Buffer.isBuffer(chunk)
        ? chunk
        : (globalThis as any).Buffer.from(chunk);
      chunks.push(bufferChunk);
    }

    const buffer = (globalThis as any).Buffer.concat(chunks);
    const fileSize = buffer.length;

    // Report initial progress
    if (options?.onProgress) {
      options.onProgress(5); // 5% - buffer collected
    }

    // Use multipart upload for large files
    if (fileSize > MULTIPART_UPLOAD_THRESHOLD) {
      return await this.multipartUpload(
        buffer,
        bucket,
        key,
        options?.contentType || this.defaultContentType,
        options?.metadata,
        options?.onProgress
      );
    } else {
      // Use simple upload for smaller files
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: options?.contentType || this.defaultContentType,
        Metadata: options?.metadata,
      });

      try {
        if (options?.onProgress) {
          options.onProgress(50); // 50% - uploading
        }
        await this.s3Client.send(command);
        if (options?.onProgress) {
          options.onProgress(100); // 100% - complete
        }
      } catch (error: any) {
        const region = typeof this.s3Client.config.region === "string" 
          ? this.s3Client.config.region 
          : "unknown";
        if (error.message?.includes("endpoint") || error.message?.includes("region")) {
          throw new Error(
            `S3 upload failed: ${error.message}. Please verify the bucket region matches the configured region (${region}). Ensure AWS_REGION is set correctly in your .env file.`
          );
        }
        throw error;
      }

      return { bucket, key };
    }
  }

  /**
   * Perform multipart upload for large files.
   */
  private async multipartUpload(
    buffer: Buffer,
    bucket: string,
    key: string,
    contentType: string,
    metadata?: Record<string, string>,
    onProgress?: (progress: number) => void
  ): Promise<{ bucket: string; key: string }> {
    let uploadId: string | undefined;

    try {
      // Step 1: Initialize multipart upload
      const createCommand = new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        Metadata: metadata,
      });

      const createResponse = await this.s3Client.send(createCommand);
      uploadId = createResponse.UploadId;

      if (!uploadId) {
        throw new Error("Failed to create multipart upload");
      }

      if (onProgress) {
        onProgress(10); // 10% - multipart upload initialized
      }

      // Step 2: Upload parts
      const parts: Array<{ ETag: string; PartNumber: number }> = [];
      const totalParts = Math.ceil(buffer.length / MULTIPART_PART_SIZE);
      const progressPerPart = 80 / totalParts; // 80% for parts (10% init, 10% complete)

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * MULTIPART_PART_SIZE;
        const end = Math.min(start + MULTIPART_PART_SIZE, buffer.length);
        const partBuffer = buffer.slice(start, end);

        const uploadPartCommand = new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          PartNumber: partNumber,
          UploadId: uploadId,
          Body: partBuffer,
        });

        const partResponse = await this.s3Client.send(uploadPartCommand);

        if (!partResponse.ETag) {
          throw new Error(`Failed to upload part ${partNumber}`);
        }

        parts.push({
          ETag: partResponse.ETag,
          PartNumber: partNumber,
        });

        // Update progress: 10% (init) + (partNumber / totalParts) * 80%
        if (onProgress) {
          const progress = 10 + (partNumber / totalParts) * 80;
          onProgress(Math.min(Math.round(progress), 90)); // Cap at 90% until complete
        }
      }

      // Step 3: Complete multipart upload
      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts,
        },
      });

      if (onProgress) {
        onProgress(95); // 95% - completing upload
      }

      await this.s3Client.send(completeCommand);

      if (onProgress) {
        onProgress(100); // 100% - complete
      }

      return { bucket, key };
    } catch (error: any) {
      // Abort multipart upload on error
      if (uploadId) {
        try {
          const abortCommand = new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          });
          await this.s3Client.send(abortCommand);
        } catch (abortError) {
          // Log but don't throw - original error is more important
          console.error("Failed to abort multipart upload:", abortError);
        }
      }

      const region = typeof this.s3Client.config.region === "string" 
        ? this.s3Client.config.region 
        : "unknown";
      if (error.message?.includes("endpoint") || error.message?.includes("region")) {
        throw new Error(
          `S3 upload failed: ${error.message}. Please verify the bucket region matches the configured region (${region}). Ensure AWS_REGION is set correctly in your .env file.`
        );
      }
      throw error;
    }
  }

  /**
   * Store an audio file in S3 from a buffer.
   * 
   * @param audioBuffer - The audio data as a buffer
   * @param bucket - S3 bucket name
   * @param key - S3 object key
   * @param options - Optional content type and metadata
   * @returns Object with bucket and key
   */
  async storeAudioFromBuffer(
    audioBuffer: Buffer | Uint8Array,
    bucket: string,
    key: string,
    options?: {
      contentType?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<{ bucket: string; key: string }> {
    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    // Use multipart upload for large files
    if (buffer.length > MULTIPART_UPLOAD_THRESHOLD) {
      return await this.multipartUpload(
        buffer,
        bucket,
        key,
        options?.contentType || this.defaultContentType,
        options?.metadata
      );
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: options?.contentType || this.defaultContentType,
      Metadata: options?.metadata,
    });

    await this.s3Client.send(command);

    return { bucket, key };
  }

  /**
   * Delete an audio file from S3.
   * 
   * @param bucket - S3 bucket name
   * @param key - S3 object key
   */
  async deleteAudio(bucket: string, key: string): Promise<void> {
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
   * @param bucket - S3 bucket name
   * @param key - S3 object key
   * @returns True if the file exists, false otherwise
   */
  async audioExists(bucket: string, key: string): Promise<boolean> {
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

