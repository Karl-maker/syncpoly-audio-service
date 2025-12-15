import { randomUUID } from "crypto";
import { AudioFile, AudioFilePart } from "../../domain/entities/audio-file";
import { UploadJob } from "../../domain/entities/upload-job";
import { ProcessingJob } from "../../domain/entities/processing-job";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { S3AudioStorage, S3AudioStorageConfig } from "../../infrastructure/aws/s3.audio.storage";
import { AudioSourceProvidersType } from "../../domain/enums/audio.source.provider";
import { AudioChunkingService } from "../../infrastructure/audio/audio-chunking.service";

export interface CompleteUploadAudioV2UseCaseParams {
  jobId: string;
  userId: string;
  lang?: string; // ISO-639-1 language code for transcription
  s3Config?: S3AudioStorageConfig;
  s3Bucket?: string;
  cdnUrl?: string;
}

export class CompleteUploadAudioV2UseCase {
  private chunkingService: AudioChunkingService;
  private readonly CHUNK_SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB

  constructor(
    private audioFileRepository: AudioFileRepository,
    private uploadJobRepository: UploadJobRepository,
    private processingJobRepository: ProcessingJobRepository,
    private s3Storage?: S3AudioStorage
  ) {
    this.chunkingService = new AudioChunkingService();
  }

  async execute(params: CompleteUploadAudioV2UseCaseParams): Promise<UploadJob> {
    const { jobId, userId, s3Bucket, cdnUrl, lang } = params;

    if (!this.s3Storage || !s3Bucket) {
      throw new Error("S3 storage is not configured");
    }

    // Get upload job
    const uploadJob = await this.uploadJobRepository.findById(jobId);
    if (!uploadJob) {
      throw new Error(`Upload job not found: ${jobId}`);
    }

    if (uploadJob.userId !== userId) {
      throw new Error("Unauthorized: Upload job does not belong to user");
    }

    if (!uploadJob.s3Bucket || !uploadJob.s3Key) {
      throw new Error("Upload job missing S3 information");
    }

    // Check if file exists in S3
    const fileExists = await this.s3Storage.audioExists(uploadJob.s3Bucket, uploadJob.s3Key);
    if (!fileExists) {
      throw new Error("File not found in S3. Please ensure the file was uploaded successfully.");
    }

    // Update job status to processing before starting async work
    await this.uploadJobRepository.update(uploadJob.id, {
      status: "uploading",
      startedAt: new Date(),
    });

    // Process the uploaded file asynchronously (don't wait for completion)
    this.processUploadedFile(uploadJob, userId, s3Bucket, cdnUrl, lang).catch((error) => {
      console.error(`[CompleteUploadAudioV2] Processing job ${uploadJob.id} failed:`, error);
    });

    // Return immediately - processing happens in background
    return uploadJob;
  }

  private async processUploadedFile(
    uploadJob: UploadJob,
    userId: string,
    s3Bucket: string,
    cdnUrl?: string,
    lang?: string
  ): Promise<void> {
    // Declare variables outside try block so they're accessible in catch block
    let temporaryProcessingJobId: string | undefined;
    let audioFile: AudioFile | undefined;

    try {
      // Get file metadata from S3
      const fileMetadata = await this.s3Storage!.getFileMetadata(
        uploadJob.s3Bucket!,
        uploadJob.s3Key!
      );

      // Get the file stream from S3
      const fileStream = await this.s3Storage!.getAudioStream(
        uploadJob.s3Bucket!,
        uploadJob.s3Key!
      );

      // Read file into buffer for processing
      const chunks: Buffer[] = [];
      for await (const chunk of fileStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const fileBuffer = Buffer.concat(chunks);

      // Update job progress (status already set to "uploading" in execute)
      await this.uploadJobRepository.update(uploadJob.id, {
        progress: 10,
      });

      let s3BucketName: string | undefined;
      let s3Key: string | undefined;
      let parts: AudioFilePart[] | undefined;
      let totalDuration: number | undefined;
      const audioSourceProvider: AudioSourceProvidersType = "s3";

      // Check if file should be chunked
      const shouldChunk = this.chunkingService.shouldChunkFile(
        fileBuffer.length,
        this.CHUNK_SIZE_THRESHOLD
      );

      if (shouldChunk) {
        console.log(
          `[CompleteUploadAudioV2] File size ${fileBuffer.length} exceeds threshold, chunking into parts`
        );

        // Chunk the file into 10MB parts
        const chunks = await this.chunkingService.chunkAudioFile(
          fileBuffer,
          fileMetadata.contentType || "audio/wav",
          {
            chunkSizeBytes: 10 * 1024 * 1024,
            onProgress: async (progress: number) => {
              const chunkingProgress = 10 + Math.floor(progress * 0.2);
              await this.uploadJobRepository.update(uploadJob.id, {
                progress: Math.min(chunkingProgress, 29),
              });
            },
          }
        );

        console.log(`[CompleteUploadAudioV2] Chunked into ${chunks.length} parts`);

        // Calculate total duration from chunks - before processing
        totalDuration = chunks.length > 0 ? chunks[chunks.length - 1].endTimeSec : undefined;
        if (totalDuration) {
          console.log(
            `[CompleteUploadAudioV2] Total duration (from chunks): ${totalDuration.toFixed(2)} seconds`
          );

          // Create temporary AudioFile and ProcessingJob now (before processing)
          if (totalDuration > 0) {
            try {
              audioFile = await this.audioFileRepository.create({
                userId,
                filename: uploadJob.filename,
                originalFilename: uploadJob.filename,
                s3Bucket: undefined,
                s3Key: undefined,
                parts: undefined,
                partCount: chunks.length,
                cdnUrl: undefined,
                audioSourceProvider,
                fileSize: fileBuffer.length,
                duration: totalDuration,
                mimeType: fileMetadata.contentType || "audio/wav",
                lang,
                uploadedAt: new Date(),
              } as Omit<AudioFile, "id" | "createdAt" | "updatedAt">);

              const processingJob = await this.processingJobRepository.create({
                audioFileId: audioFile.id,
                userId,
                status: "pending",
                progress: 0,
                processedParts: [],
                lastProcessedPartIndex: -1,
                vectorStoreType: "openai",
                lang,
                retryCount: 0,
                maxRetries: 5,
              } as Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">);

              temporaryProcessingJobId = processingJob.id;
              console.log(
                `[CompleteUploadAudioV2] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s`
              );
            } catch (error: any) {
              console.error(`[CompleteUploadAudioV2] Failed to create temporary ProcessingJob early:`, error);
            }
          }
        }

        // Move chunks to final S3 location
        // Extract file extension for S3 key
        const fileExtension = uploadJob.filename.split(".").pop() || "";
        const extension = fileExtension ? `.${fileExtension}` : "";
        const fileBaseKey = `users/${userId}/audio/${randomUUID()}${extension}`;
        parts = [];
        const uploadProgressPerPart = 70 / chunks.length;

        await this.uploadJobRepository.update(uploadJob.id, {
          progress: 30,
        });

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const partKey = `${fileBaseKey}-part-${i}`;
          const { Readable } = await import("stream");
          const chunkStream = Readable.from(chunk.buffer);

          const result = await this.s3Storage!.storeAudio(chunkStream, s3Bucket, partKey, {
            contentType: fileMetadata.contentType || "audio/wav",
            metadata: {
              userId,
              originalFilename: uploadJob.filename,
              partIndex: i.toString(),
              totalParts: chunks.length.toString(),
            },
            onProgress: async (partProgress: number) => {
              const partProgressValue = (i * uploadProgressPerPart) + (partProgress * uploadProgressPerPart / 100);
              const totalProgress = 30 + partProgressValue;
              await this.uploadJobRepository.update(uploadJob.id, {
                progress: Math.min(Math.floor(totalProgress), 99),
              });
            },
          });

            let partCdnUrl: string | undefined;
            if (cdnUrl) {
              const cdnBase = cdnUrl.replace(/\/$/, "");
              // CDN URL format: https://cdn.example.com/key (no bucket name)
              partCdnUrl = `${cdnBase}/${result.key}`;
            }

          parts.push({
            s3Key: result.key,
            partIndex: i,
            fileSize: chunk.buffer.length,
            cdnUrl: partCdnUrl,
          });

          if (i === 0) {
            s3BucketName = result.bucket;
            // Keep original file's key, not the first part's key
            // The original whole file is at uploadJob.s3Key
            s3Key = uploadJob.s3Key || result.key;
          }
        }

        console.log(`[CompleteUploadAudioV2] Uploaded ${parts.length} parts`);
      } else {
        // Single file - get duration first
        try {
          const { exec } = await import("child_process");
          const { promisify } = await import("util");
          const { writeFile, unlink } = await import("fs/promises");
          const { join } = await import("path");
          const { tmpdir } = await import("os");
          const execAsync = promisify(exec);

          const tempDir = tmpdir();
          const tempFile = join(tempDir, `${randomUUID()}-audio`);
          await writeFile(tempFile, fileBuffer);

          const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempFile}"`;
          const { stdout } = await execAsync(probeCmd);
          totalDuration = parseFloat(stdout.trim()) || undefined;

          await unlink(tempFile).catch(() => {});
          if (totalDuration) {
            console.log(
              `[CompleteUploadAudioV2] Single file duration (early): ${totalDuration.toFixed(2)} seconds`
            );

            // Create temporary AudioFile and ProcessingJob now (before processing)
            if (totalDuration > 0) {
              try {
                audioFile = await this.audioFileRepository.create({
                  userId,
                  filename: uploadJob.filename,
                  originalFilename: uploadJob.filename,
                  s3Bucket: undefined,
                  s3Key: undefined,
                  parts: undefined,
                  partCount: undefined,
                  cdnUrl: undefined,
                  audioSourceProvider,
                  fileSize: fileBuffer.length,
                  duration: totalDuration,
                  mimeType: fileMetadata.contentType || "audio/wav",
                  lang,
                  uploadedAt: new Date(),
                } as Omit<AudioFile, "id" | "createdAt" | "updatedAt">);

                const processingJob = await this.processingJobRepository.create({
                  audioFileId: audioFile.id,
                  userId,
                  status: "pending",
                  progress: 0,
                  processedParts: [],
                  lastProcessedPartIndex: -1,
                  vectorStoreType: "openai",
                  lang,
                  retryCount: 0,
                  maxRetries: 5,
                } as Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">);

                temporaryProcessingJobId = processingJob.id;
                console.log(
                  `[CompleteUploadAudioV2] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s (before processing)`
                );
              } catch (error: any) {
                console.error(`[CompleteUploadAudioV2] Failed to create temporary ProcessingJob early:`, error);
              }
            }
          }
        } catch (error) {
          console.warn(`[CompleteUploadAudioV2] Could not determine duration for single file:`, error);
        }

        // Move file to final S3 location
        const fileExtension = uploadJob.filename.split(".").pop() || "";
        const extension = fileExtension ? `.${fileExtension}` : "";
        const key = `users/${userId}/audio/${randomUUID()}${extension}`;
        const { Readable } = await import("stream");
        const fileStream = Readable.from(fileBuffer);

        const result = await this.s3Storage!.storeAudio(fileStream, s3Bucket, key, {
          contentType: fileMetadata.contentType || "audio/wav",
          metadata: {
            userId,
            originalFilename: uploadJob.filename,
          },
          onProgress: async (progress: number) => {
            const totalProgress = 10 + Math.floor(progress * 0.9);
            await this.uploadJobRepository.update(uploadJob.id, {
              progress: Math.min(totalProgress, 99),
            });
          },
        });

        s3BucketName = result.bucket;
        s3Key = result.key;
      }

      // Generate CDN URL if configured
      // Always use the original whole file (uploadJob.s3Key) if available, not parts
      let generatedCdnUrl: string | undefined;
      const keyForCdn = uploadJob.s3Key || s3Key; // Prefer original file over parts
      if (cdnUrl && keyForCdn) {
        const cdnBase = cdnUrl.replace(/\/$/, "");
        // CDN URL format: https://cdn.example.com/key (no bucket name)
        generatedCdnUrl = `${cdnBase}/${keyForCdn}`;
        console.log(`[CompleteUploadAudioV2] Generated CDN URL for original file: ${generatedCdnUrl}`);
      }

      // Update AudioFile with S3 info (if created early) or create it now
      if (audioFile) {
        await this.audioFileRepository.update(audioFile.id, {
          s3Bucket: s3BucketName,
          s3Key,
          parts,
          partCount: parts?.length,
          cdnUrl: generatedCdnUrl,
        });
      } else {
        audioFile = await this.audioFileRepository.create({
          userId,
          filename: uploadJob.filename,
          originalFilename: uploadJob.filename,
          s3Bucket: s3BucketName,
          s3Key,
          parts,
          partCount: parts?.length,
          cdnUrl: generatedCdnUrl,
          audioSourceProvider,
          fileSize: fileBuffer.length,
          duration: totalDuration,
          mimeType: fileMetadata.contentType || "audio/wav",
          lang,
          uploadedAt: new Date(),
        } as Omit<AudioFile, "id" | "createdAt" | "updatedAt">);

        if (totalDuration && totalDuration > 0) {
          try {
            const processingJob = await this.processingJobRepository.create({
              audioFileId: audioFile.id,
              userId,
              status: "pending",
              progress: 0,
              processedParts: [],
              lastProcessedPartIndex: -1,
              vectorStoreType: "openai",
              lang,
              retryCount: 0,
              maxRetries: 5,
            } as Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">);
            temporaryProcessingJobId = processingJob.id;
            console.log(
              `[CompleteUploadAudioV2] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s`
            );
          } catch (processingJobError: any) {
            console.error(`[CompleteUploadAudioV2] Failed to create temporary ProcessingJob:`, processingJobError);
          }
        }
      }

      // Delete the temporary upload file from S3
      try {
        await this.s3Storage!.deleteAudio(uploadJob.s3Bucket!, uploadJob.s3Key!);
        console.log(`[CompleteUploadAudioV2] Deleted temporary upload file: ${uploadJob.s3Key}`);
      } catch (deleteError) {
        console.warn(`[CompleteUploadAudioV2] Failed to delete temporary upload file:`, deleteError);
      }

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
      // Remove temporary ProcessingJob if processing failed
      if (temporaryProcessingJobId) {
        try {
          await this.processingJobRepository.delete(temporaryProcessingJobId);
          console.log(
            `[CompleteUploadAudioV2] Removed temporary ProcessingJob ${temporaryProcessingJobId} due to processing failure`
          );
        } catch (deleteError: any) {
          console.error(
            `[CompleteUploadAudioV2] Failed to remove temporary ProcessingJob ${temporaryProcessingJobId}:`,
            deleteError
          );
        }
      }

      // Remove temporary AudioFile if it was created early
      if (audioFile && (!audioFile.s3Bucket || !audioFile.s3Key)) {
        try {
          await this.audioFileRepository.delete(audioFile.id);
          console.log(`[CompleteUploadAudioV2] Removed temporary AudioFile ${audioFile.id} due to processing failure`);
        } catch (deleteError: any) {
          console.error(`[CompleteUploadAudioV2] Failed to remove temporary AudioFile ${audioFile.id}:`, deleteError);
        }
      }

      await this.uploadJobRepository.update(uploadJob.id, {
        status: "failed",
        error: error.message || "Unknown error",
        completedAt: new Date(),
      });
      throw error;
    }
  }
}

