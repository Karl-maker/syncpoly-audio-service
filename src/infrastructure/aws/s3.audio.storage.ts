import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

/**
 * Sanitizes metadata values to remove invalid characters for HTTP headers.
 * AWS S3 metadata keys and values must be valid HTTP header values.
 * HTTP headers cannot contain control characters, newlines, or certain special characters.
 * This function ensures only safe characters are kept: alphanumeric, spaces, hyphens, underscores, periods, and commas.
 */
function sanitizeMetadataValue(value: string): string {
  if (!value) return "";
  
  // Convert to string
  let str = String(value);
  
  // Only allow: alphanumeric (a-z, A-Z, 0-9), spaces, hyphens, underscores, periods, commas
  // Replace everything else with underscore or remove it
  str = str
    .replace(/[^a-zA-Z0-9\s\-_.,]/g, "_") // Replace invalid chars with underscore
    .replace(/\s+/g, " ") // Collapse multiple spaces to single space
    .trim();
  
  // Limit to AWS metadata value limit (2KB)
  if (str.length > 2000) {
    str = str.substring(0, 2000);
  }
  
  return str;
}

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
    // Report progress during collection for better UX
    const chunks: Buffer[] = [];
    let totalBytesCollected = 0;
    let lastProgressReport = 0;
    const progressReportInterval = 0.5; // Report every 0.5% during collection
    
    for await (const chunk of audioStream as Readable) {
      const bufferChunk = (globalThis as any).Buffer.isBuffer(chunk)
        ? chunk
        : (globalThis as any).Buffer.from(chunk);
      chunks.push(bufferChunk);
      totalBytesCollected += bufferChunk.length;
      
      // Report progress during collection (estimate 0-3% for collection phase)
      // We don't know total size yet, so estimate based on chunks collected
      if (options?.onProgress && chunks.length % 10 === 0) {
        // Estimate: assume we're at ~1-2% during collection
        const estimatedProgress = Math.min(2, (chunks.length / 100) * 2);
        if (estimatedProgress - lastProgressReport >= progressReportInterval) {
          options.onProgress(estimatedProgress);
          lastProgressReport = estimatedProgress;
        }
      }
    }

    const buffer = (globalThis as any).Buffer.concat(chunks);
    const fileSize = buffer.length;

    // Report buffer collection complete
    if (options?.onProgress) {
      options.onProgress(3); // 3% - buffer collected
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
      // Sanitize metadata values to avoid invalid header characters
      const sanitizedMetadata = options?.metadata 
        ? Object.fromEntries(
            Object.entries(options.metadata).map(([k, v]) => [k, sanitizeMetadataValue(v)])
          )
        : undefined;
      
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: options?.contentType || this.defaultContentType,
        Metadata: sanitizedMetadata,
      });

      try {
        // For simple uploads, report progress more gradually
        if (options?.onProgress) {
          options.onProgress(10); // 10% - starting upload
        }
        
        // Use a promise that we can track
        const uploadPromise = this.s3Client.send(command);
        
        // Report intermediate progress for simple uploads
        // Since we can't track actual upload progress, we'll simulate it
        if (options?.onProgress) {
          const progressSteps = [20, 30, 40, 50, 60, 70, 80, 90];
          let stepIndex = 0;
          
          const progressInterval = setInterval(() => {
            if (stepIndex < progressSteps.length) {
              options.onProgress!(progressSteps[stepIndex]);
              stepIndex++;
            } else {
              clearInterval(progressInterval);
            }
          }, 200); // Update every 200ms for smoother progress
          
          // Clear interval when upload completes
          uploadPromise.finally(() => {
            clearInterval(progressInterval);
          });
        }
        
        await uploadPromise;
        
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
      // Sanitize metadata values to avoid invalid header characters
      const sanitizedMetadata = metadata 
        ? Object.fromEntries(
            Object.entries(metadata).map(([k, v]) => [k, sanitizeMetadataValue(v)])
          )
        : undefined;
      
      const createCommand = new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        Metadata: sanitizedMetadata,
      });

      const createResponse = await this.s3Client.send(createCommand);
      uploadId = createResponse.UploadId;

      if (!uploadId) {
        throw new Error("Failed to create multipart upload");
      }

      if (onProgress) {
        onProgress(5); // 5% - multipart upload initialized
      }

      // Step 2: Upload parts
      const parts: Array<{ ETag: string; PartNumber: number }> = [];
      const totalParts = Math.ceil(buffer.length / MULTIPART_PART_SIZE);
      const progressPerPart = 85 / totalParts; // 85% for parts (5% init, 10% complete)

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * MULTIPART_PART_SIZE;
        const end = Math.min(start + MULTIPART_PART_SIZE, buffer.length);
        const partBuffer = buffer.slice(start, end);

        // Report progress at start of part upload
        if (onProgress) {
          const partStartProgress = 5 + ((partNumber - 1) / totalParts) * 85;
          onProgress(Math.round(partStartProgress));
        }

        const uploadPartCommand = new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          PartNumber: partNumber,
          UploadId: uploadId,
          Body: partBuffer,
        });

        // Simulate progress during part upload (since AWS SDK doesn't provide it)
        let partProgressInterval: NodeJS.Timeout | null = null;
        if (onProgress && totalParts > 1) {
          const partProgressStart = 5 + ((partNumber - 1) / totalParts) * 85;
          const partProgressEnd = 5 + (partNumber / totalParts) * 85;
          const partProgressRange = partProgressEnd - partProgressStart;
          let simulatedProgress = 0;
          
          partProgressInterval = setInterval(() => {
            simulatedProgress += 0.1; // Increment by 0.1% every 100ms
            if (simulatedProgress < 0.8) { // Simulate up to 80% of part progress
              const currentProgress = partProgressStart + (simulatedProgress * partProgressRange);
              onProgress(Math.min(Math.round(currentProgress), 90));
            }
          }, 100);
        }

        const partResponse = await this.s3Client.send(uploadPartCommand);

        // Clear progress interval
        if (partProgressInterval) {
          clearInterval(partProgressInterval);
        }

        if (!partResponse.ETag) {
          throw new Error(`Failed to upload part ${partNumber}`);
        }

        parts.push({
          ETag: partResponse.ETag,
          PartNumber: partNumber,
        });

        // Update progress: 5% (init) + (partNumber / totalParts) * 85%
        if (onProgress) {
          const progress = 5 + (partNumber / totalParts) * 85;
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

    // Sanitize metadata values to avoid invalid header characters
    const sanitizedMetadata = options?.metadata 
      ? Object.fromEntries(
          Object.entries(options.metadata).map(([k, v]) => [k, sanitizeMetadataValue(v)])
        )
      : undefined;
    
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: options?.contentType || this.defaultContentType,
      Metadata: sanitizedMetadata,
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

  /**
   * Generate a presigned URL for uploading a file directly to S3.
   * 
   * @param bucket - S3 bucket name
   * @param key - S3 object key
   * @param options - Optional content type, metadata, and expiration time
   * @returns Presigned URL for PUT request
   */
  async getPresignedUploadUrl(
    bucket: string,
    key: string,
    options?: {
      contentType?: string;
      metadata?: Record<string, string>;
      expiresIn?: number; // Expiration time in seconds (default: 3600 = 1 hour)
    }
  ): Promise<string> {
    // Sanitize metadata values to avoid invalid header characters
    const sanitizedMetadata = options?.metadata 
      ? Object.fromEntries(
          Object.entries(options.metadata).map(([k, v]) => [k, sanitizeMetadataValue(v)])
        )
      : undefined;
    
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: options?.contentType || this.defaultContentType,
      Metadata: sanitizedMetadata,
    });

    const expiresIn = options?.expiresIn || 3600; // Default 1 hour

    // Type assertion to fix compatibility issue with getSignedUrl
    return await getSignedUrl(this.s3Client as any, command, { expiresIn });
  }

  /**
   * Get a file from S3 as a readable stream.
   * 
   * @param bucket - S3 bucket name
   * @param key - S3 object key
   * @returns Readable stream of the file
   */
  async getAudioStream(bucket: string, key: string): Promise<Readable> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    
    if (!response.Body) {
      throw new Error(`File not found: ${bucket}/${key}`);
    }

    // AWS SDK v3 returns Body as a stream-like object
    // Convert to Node.js Readable stream
    if (response.Body instanceof Readable) {
      return response.Body;
    }
    
    // For other types, read as async iterable and convert to Readable
    const stream = new Readable({
      read() {
        // This will be populated by the async iterator
      },
    });
    
    // Read the body as async iterable and push to stream
    (async () => {
      try {
        // AWS SDK v3 Body is typically an async iterable
        if (response.Body && typeof (response.Body as any)[Symbol.asyncIterator] === 'function') {
          for await (const chunk of response.Body as any) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            stream.push(buffer);
          }
          stream.push(null);
        } else {
          // Fallback: treat as single buffer
          const buffer = Buffer.isBuffer(response.Body) 
            ? response.Body 
            : Buffer.from(response.Body as any);
          stream.push(buffer);
          stream.push(null);
        }
      } catch (error) {
        stream.destroy(error as Error);
      }
    })();
    
    return stream;
  }

  /**
   * Get file metadata from S3.
   * 
   * @param bucket - S3 bucket name
   * @param key - S3 object key
   * @returns File metadata including size and content type
   */
  async getFileMetadata(bucket: string, key: string): Promise<{
    size: number;
    contentType?: string;
    metadata?: Record<string, string>;
  }> {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    
    return {
      size: response.ContentLength || 0,
      contentType: response.ContentType,
      metadata: response.Metadata,
    };
  }
}

