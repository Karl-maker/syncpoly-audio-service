import { randomUUID } from "crypto";
import { AudioFile, AudioFilePart } from "../../domain/entities/audio-file";
import { UploadJob } from "../../domain/entities/upload-job";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { S3AudioStorage, S3AudioStorageConfig } from "../../infrastructure/aws/s3.audio.storage";
import { AudioSourceProvidersType } from "../../domain/enums/audio.source.provider";
import { AudioChunkingService } from "../../infrastructure/audio/audio-chunking.service";

export interface UploadAudioUseCaseParams {
  file: Express.Multer.File;
  userId: string;
  s3Config?: S3AudioStorageConfig;
  s3Bucket?: string;
  cdnUrl?: string; // Optional CDN URL base (e.g., "https://cdn.example.com")
}

export class UploadAudioUseCase {
  private chunkingService: AudioChunkingService;
  private readonly CHUNK_SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB

  constructor(
    private audioFileRepository: AudioFileRepository,
    private uploadJobRepository: UploadJobRepository,
    private s3Storage?: S3AudioStorage
  ) {
    this.chunkingService = new AudioChunkingService();
  }

  async execute(params: UploadAudioUseCaseParams): Promise<UploadJob> {
    const { file, userId, s3Bucket } = params;

    // Create upload job
    const now = new Date();
    const uploadJob = await this.uploadJobRepository.create({
      userId,
      filename: file.originalname,
      status: "pending",
      progress: 0,
    } as Omit<UploadJob, "id" | "createdAt" | "updatedAt">);

    // Start upload asynchronously
    this.uploadAudioAsync(uploadJob, file, userId, s3Bucket, params.cdnUrl).catch((error) => {
      console.error(`Upload job ${uploadJob.id} failed:`, error);
    });

    return uploadJob;
  }

  private async uploadAudioAsync(
    uploadJob: UploadJob,
    file: Express.Multer.File,
    userId: string,
    s3Bucket?: string,
    cdnUrl?: string
  ): Promise<void> {
    try {
      // Update job status to uploading
      await this.uploadJobRepository.update(uploadJob.id, {
        status: "uploading",
        startedAt: new Date(),
        progress: 0,
      });

      let s3BucketName: string | undefined;
      let s3Key: string | undefined;
      let parts: AudioFilePart[] | undefined;
      let totalDuration: number | undefined;
      const audioSourceProvider: AudioSourceProvidersType = "s3";

      // Check if file should be chunked
      const shouldChunk = this.chunkingService.shouldChunkFile(file.size, this.CHUNK_SIZE_THRESHOLD);

      // Upload to S3 if storage is configured
      if (this.s3Storage && s3Bucket) {
        if (shouldChunk) {
          console.log(`[UploadAudio] File size ${file.size} exceeds threshold, chunking into parts`);
          
          // Chunk the file into 10MB parts and store each as a separate S3 object
          const chunks = await this.chunkingService.chunkAudioFile(
            file.buffer,
            file.mimetype,
            {
              chunkSizeBytes: 10 * 1024 * 1024, // 10MB chunks (well under OpenAI's 25MB limit)
              onProgress: async (progress: number, partIndex: number) => {
                // Chunking is 0-30% of total progress
                // Progress from chunking service is 0-99%, map to 0-30% of total
                const chunkingProgress = Math.floor(progress * 0.3);
                await this.uploadJobRepository.update(uploadJob.id, {
                  progress: Math.min(chunkingProgress, 29), // Cap at 29% during chunking
                });
              },
            }
          );

          console.log(`[UploadAudio] Chunked into ${chunks.length} parts`);

          // Calculate total duration from chunks (last chunk's endTimeSec)
          totalDuration = chunks.length > 0 ? chunks[chunks.length - 1].endTimeSec : undefined;
          if (totalDuration) {
            console.log(`[UploadAudio] Total duration: ${totalDuration.toFixed(2)} seconds`);
          }

          // Update progress to 30% when chunking is complete and upload starts
          await this.uploadJobRepository.update(uploadJob.id, {
            progress: 30,
          });

          // Upload each 10MB chunk as a separate S3 object
          // Each part is stored independently in S3 for direct processing later
          const fileBaseKey = `users/${userId}/${randomUUID()}-${file.originalname}`;
          parts = [];
          const uploadProgressPerPart = 70 / chunks.length; // 70% for uploads (30-99%)
          
          // Update progress to 30% when chunking is complete and upload starts
          await this.uploadJobRepository.update(uploadJob.id, {
            progress: 30,
          });

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            // Each chunk gets its own unique S3 key: {baseKey}-part-{index}
            const partKey = `${fileBaseKey}-part-${i}`;
            const { Readable } = await import("stream");
            const chunkStream = Readable.from(chunk.buffer);

            // Store each chunk as a separate S3 object
            const result = await this.s3Storage.storeAudio(
              chunkStream,
              s3Bucket,
              partKey,
              {
                contentType: file.mimetype,
                metadata: {
                  userId,
                  originalFilename: file.originalname,
                  partIndex: i.toString(),
                  totalParts: chunks.length.toString(),
                },
                onProgress: async (partProgress: number) => {
                  // Upload progress for this part: 30% base + progress through all parts
                  // Calculate progress through this specific part
                  const partProgressValue = (i * uploadProgressPerPart) + (partProgress * uploadProgressPerPart / 100);
                  const totalProgress = 30 + partProgressValue;
                  // Cap at 99% during upload - only set to 100% when job is actually completed
                  await this.uploadJobRepository.update(uploadJob.id, {
                    progress: Math.min(Math.floor(totalProgress), 99),
                  });
                },
              }
            );

            // Generate CDN URL for this part if CDN is configured
            let partCdnUrl: string | undefined;
            if (cdnUrl) {
              const cdnBase = cdnUrl.replace(/\/$/, "");
              partCdnUrl = `${cdnBase}/${result.bucket}/${result.key}`;
            }

            parts.push({
              s3Key: result.key,
              partIndex: i,
              fileSize: chunk.buffer.length,
              cdnUrl: partCdnUrl,
            });

            // Set bucket and first key for backward compatibility
            if (i === 0) {
              s3BucketName = result.bucket;
              s3Key = result.key;
            }
          }

          console.log(`[UploadAudio] Uploaded ${parts.length} parts`);
        } else {
          // Single file upload (backward compatible)
          // Get duration for single file using ffprobe
          try {
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const { writeFile, unlink } = await import("fs/promises");
            const { join } = await import("path");
            const { tmpdir } = await import("os");
            const execAsync = promisify(exec);
            
            const tempDir = tmpdir();
            const tempFile = join(tempDir, `${randomUUID()}-audio`);
            await writeFile(tempFile, file.buffer);
            
            const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempFile}"`;
            const { stdout } = await execAsync(probeCmd);
            totalDuration = parseFloat(stdout.trim()) || undefined;
            
            await unlink(tempFile).catch(() => {});
            if (totalDuration) {
              console.log(`[UploadAudio] Single file duration: ${totalDuration.toFixed(2)} seconds`);
            }
          } catch (error) {
            console.warn(`[UploadAudio] Could not determine duration for single file:`, error);
          }

          const { Readable } = await import("stream");
          const fileStream = Readable.from(file.buffer);
          const key = `users/${userId}/${randomUUID()}-${file.originalname}`;

          // Track progress during upload
          const result = await this.s3Storage.storeAudio(
            fileStream,
            s3Bucket,
            key,
            {
              contentType: file.mimetype,
              metadata: {
                userId,
                originalFilename: file.originalname,
              },
              onProgress: async (progress: number) => {
                // Update progress in database, cap at 99% until completion
                await this.uploadJobRepository.update(uploadJob.id, {
                  progress: Math.min(progress, 99),
                });
              },
            }
          );

          s3BucketName = result.bucket;
          s3Key = result.key;
        }
      }

      // Generate CDN URL if CDN is configured (for first part or single file)
      let generatedCdnUrl: string | undefined;
      if (cdnUrl && s3BucketName && s3Key) {
        // Remove trailing slash from CDN URL if present
        const cdnBase = cdnUrl.replace(/\/$/, "");
        // CDN URL format: https://cdn.example.com/bucket/key
        generatedCdnUrl = `${cdnBase}/${s3BucketName}/${s3Key}`;
        console.log(`[UploadAudio] Generated CDN URL: ${generatedCdnUrl}`);
      }

      // Save metadata to database
      const now = new Date();
      const audioFile = await this.audioFileRepository.create({
        userId,
        filename: file.originalname,
        originalFilename: file.originalname,
        s3Bucket: s3BucketName,
        s3Key, // Backward compatibility: points to first part
        parts, // Array of parts for chunked uploads
        partCount: parts?.length,
        cdnUrl: generatedCdnUrl, // CDN URL for first part or single file
        audioSourceProvider,
        fileSize: file.size,
        duration: totalDuration,
        mimeType: file.mimetype,
        uploadedAt: now,
      } as Omit<AudioFile, "id" | "createdAt" | "updatedAt">);

      // Update job with completion
      await this.uploadJobRepository.update(uploadJob.id, {
        status: "completed",
        progress: 100,
        audioFileId: audioFile.id,
        s3Bucket: s3BucketName,
        s3Key,
        completedAt: new Date(),
      });
    } catch (error: any) {
      await this.uploadJobRepository.update(uploadJob.id, {
        status: "failed",
        error: error.message || "Unknown error",
        completedAt: new Date(),
      });
    }
  }
}

