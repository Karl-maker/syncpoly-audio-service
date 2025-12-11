import { randomUUID } from "crypto";
import { AudioFile, AudioFilePart } from "../../domain/entities/audio-file";
import { UploadJob } from "../../domain/entities/upload-job";
import { ProcessingJob } from "../../domain/entities/processing-job";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { S3AudioStorage, S3AudioStorageConfig } from "../../infrastructure/aws/s3.audio.storage";
import { VideoConverterService } from "../../infrastructure/video/video-converter.service";
import { AudioSourceProvidersType } from "../../domain/enums/audio.source.provider";
import { AudioChunkingService } from "../../infrastructure/audio/audio-chunking.service";
import { Readable } from "stream";

export interface CompleteUploadVideoV2UseCaseParams {
  jobId: string;
  userId: string;
  s3Config?: S3AudioStorageConfig;
  s3Bucket?: string;
  cdnUrl?: string;
}

export class CompleteUploadVideoV2UseCase {
  private videoConverter: VideoConverterService;
  private chunkingService: AudioChunkingService;
  private readonly CHUNK_SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB

  constructor(
    private audioFileRepository: AudioFileRepository,
    private uploadJobRepository: UploadJobRepository,
    private processingJobRepository: ProcessingJobRepository,
    private s3Storage?: S3AudioStorage
  ) {
    this.videoConverter = new VideoConverterService();
    this.chunkingService = new AudioChunkingService();
  }

  async execute(params: CompleteUploadVideoV2UseCaseParams): Promise<UploadJob> {
    const { jobId, userId, s3Bucket, cdnUrl } = params;

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

    // Process the uploaded video file asynchronously (don't wait for completion)
    this.processUploadedVideo(uploadJob, userId, s3Bucket, cdnUrl).catch((error) => {
      console.error(`[CompleteUploadVideoV2] Processing job ${uploadJob.id} failed:`, error);
    });

    // Return immediately - processing happens in background
    return uploadJob;
  }

  private async processUploadedVideo(
    uploadJob: UploadJob,
    userId: string,
    s3Bucket: string,
    cdnUrl?: string
  ): Promise<void> {
    const jobId = uploadJob.id;
    // Declare variables outside try block so they're accessible in catch block
    let temporaryProcessingJobId: string | undefined;
    let audioFile: AudioFile | undefined;

    try {
      // Get file metadata from S3
      const fileMetadata = await this.s3Storage!.getFileMetadata(
        uploadJob.s3Bucket!,
        uploadJob.s3Key!
      );

      // Get the video file stream from S3
      const videoStream = await this.s3Storage!.getAudioStream(
        uploadJob.s3Bucket!,
        uploadJob.s3Key!
      );

      // Read video into buffer
      const chunks: Buffer[] = [];
      for await (const chunk of videoStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const videoBuffer = Buffer.concat(chunks);

      // Update job status to converting and progress (startedAt already set in execute)
      await this.uploadJobRepository.update(jobId, {
        status: "converting",
        progress: 10,
      });

      let videoS3BucketName: string | undefined;
      let videoS3Key: string | undefined;
      let s3BucketName: string | undefined;
      let s3Key: string | undefined;
      const audioSourceProvider: AudioSourceProvidersType = "s3";

      // Step 1: Move original video to permanent location (10-30% progress)
      if (this.s3Storage && s3Bucket) {
        const videoKey = `users/${userId}/videos/${randomUUID()}-${uploadJob.filename}`;
        const videoStreamForS3 = Readable.from(videoBuffer);

        const videoResult = await this.s3Storage.storeAudio(videoStreamForS3, s3Bucket, videoKey, {
          contentType: fileMetadata.contentType || "video/mp4",
          metadata: {
            userId,
            originalFilename: uploadJob.filename,
            type: "video",
          },
          onProgress: async (progress: number) => {
            const totalProgress = 10 + Math.floor(progress * 0.2);
            await this.uploadJobRepository.update(jobId, {
              progress: totalProgress,
            });
          },
        });

        videoS3BucketName = videoResult.bucket;
        videoS3Key = videoResult.key;

        await this.uploadJobRepository.update(jobId, {
          videoS3Bucket: videoS3BucketName,
          videoS3Key: videoS3Key,
        });
      }

      // Step 2: Convert video to MP3 (30-70% progress)
      await this.uploadJobRepository.update(jobId, {
        status: "converting",
        progress: 30,
      });

      const mp3Buffer = await this.videoConverter.convertVideoToMp3(videoBuffer, {
        onProgress: async (conversionProgress: number) => {
          const totalProgress = 30 + Math.floor(conversionProgress * 0.4);
          await this.uploadJobRepository.update(jobId, {
            progress: totalProgress,
          });
        },
      });

      // Step 3: Process MP3 (chunk or upload) (70-100% progress)
      let parts: AudioFilePart[] | undefined;
      let totalDuration: number | undefined;
      const shouldChunk = this.chunkingService.shouldChunkFile(
        mp3Buffer.length,
        this.CHUNK_SIZE_THRESHOLD
      );

      if (this.s3Storage && s3Bucket) {
        if (shouldChunk) {
          console.log(
            `[CompleteUploadVideoV2] MP3 size ${mp3Buffer.length} exceeds threshold, chunking into parts`
          );

          const chunks = await this.chunkingService.chunkAudioFile(mp3Buffer, "audio/mpeg", {
            chunkSizeBytes: 10 * 1024 * 1024,
            onProgress: async (progress: number, partIndex: number) => {
              const chunkingProgress = 70 + Math.floor(progress * 0.1);
              await this.uploadJobRepository.update(jobId, {
                progress: Math.min(chunkingProgress, 79),
              });
            },
          });

          console.log(`[CompleteUploadVideoV2] Chunked MP3 into ${chunks.length} parts`);

          // Calculate total duration from chunks - before S3 upload
          totalDuration = chunks.length > 0 ? chunks[chunks.length - 1].endTimeSec : undefined;
          if (totalDuration) {
            console.log(
              `[CompleteUploadVideoV2] Total duration (from chunks, before S3 upload): ${totalDuration.toFixed(2)} seconds`
            );

            // Create temporary AudioFile and ProcessingJob now (before S3 upload)
            if (totalDuration > 0) {
              try {
                audioFile = await this.audioFileRepository.create({
                  userId,
                  filename: uploadJob.filename.replace(/\.[^/.]+$/, "") + ".mp3",
                  originalFilename: uploadJob.filename,
                  s3Bucket: undefined,
                  s3Key: undefined,
                  parts: undefined,
                  partCount: chunks.length,
                  videoSourceS3Bucket: videoS3BucketName,
                  videoSourceS3Key: videoS3Key,
                  cdnUrl: undefined,
                  audioSourceProvider,
                  fileSize: mp3Buffer.length,
                  duration: totalDuration,
                  mimeType: "audio/mpeg",
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
                  retryCount: 0,
                  maxRetries: 5,
                } as Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">);

                temporaryProcessingJobId = processingJob.id;
                console.log(
                  `[CompleteUploadVideoV2] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s (before S3 upload)`
                );
              } catch (error: any) {
                console.error(`[CompleteUploadVideoV2] Failed to create temporary ProcessingJob early:`, error);
              }
            }
          }

          await this.uploadJobRepository.update(jobId, {
            progress: 80,
          });

          const fileBaseKey = `users/${userId}/audio/${randomUUID()}-${uploadJob.filename.replace(/\.[^/.]+$/, "")}.mp3`;
          parts = [];
          const uploadProgressPerPart = 20 / chunks.length;

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const partKey = `${fileBaseKey}-part-${i}`;
            const chunkStream = Readable.from(chunk.buffer);

            const result = await this.s3Storage.storeAudio(chunkStream, s3Bucket, partKey, {
              contentType: "audio/mpeg",
              metadata: {
                userId,
                originalFilename: uploadJob.filename,
                type: "audio",
                source: "video-conversion",
                partIndex: i.toString(),
                totalParts: chunks.length.toString(),
              },
              onProgress: async (partProgress: number) => {
                const partProgressValue = (i * uploadProgressPerPart) + (partProgress * uploadProgressPerPart / 100);
                const totalProgress = 80 + partProgressValue;
                await this.uploadJobRepository.update(jobId, {
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
            }
          }

          // Upload the original whole MP3 file for CDN access (not just parts)
          const originalMp3Key = `users/${userId}/audio/${randomUUID()}-${uploadJob.filename.replace(/\.[^/.]+$/, "")}.mp3`;
          const originalMp3Stream = Readable.from(mp3Buffer);
          const originalMp3Result = await this.s3Storage.storeAudio(
            originalMp3Stream,
            s3Bucket,
            originalMp3Key,
            {
              contentType: "audio/mpeg",
              metadata: {
                userId,
                originalFilename: uploadJob.filename,
                type: "original",
                source: "video-conversion",
              },
            }
          );
          
          s3BucketName = originalMp3Result.bucket;
          s3Key = originalMp3Result.key; // Use original whole file, not first part
          console.log(`[CompleteUploadVideoV2] Uploaded original whole MP3 file for CDN: ${s3Key}`);

          console.log(`[CompleteUploadVideoV2] Uploaded ${parts.length} parts`);
        } else {
          // Single file upload
          try {
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const { writeFile, unlink } = await import("fs/promises");
            const { join } = await import("path");
            const { tmpdir } = await import("os");
            const execAsync = promisify(exec);

            const tempDir = tmpdir();
            const tempFile = join(tempDir, `${randomUUID()}-mp3`);
            await writeFile(tempFile, mp3Buffer);

            const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempFile}"`;
            const { stdout } = await execAsync(probeCmd);
            totalDuration = parseFloat(stdout.trim()) || undefined;

            await unlink(tempFile).catch(() => {});
            if (totalDuration) {
              console.log(
                `[CompleteUploadVideoV2] Single MP3 file duration (before S3 upload): ${totalDuration.toFixed(2)} seconds`
              );

              // Create temporary AudioFile and ProcessingJob now (before S3 upload)
              if (totalDuration > 0) {
                try {
                  audioFile = await this.audioFileRepository.create({
                    userId,
                    filename: uploadJob.filename.replace(/\.[^/.]+$/, "") + ".mp3",
                    originalFilename: uploadJob.filename,
                    s3Bucket: undefined,
                    s3Key: undefined,
                    parts: undefined,
                    partCount: undefined,
                    videoSourceS3Bucket: videoS3BucketName,
                    videoSourceS3Key: videoS3Key,
                    cdnUrl: undefined,
                    audioSourceProvider,
                    fileSize: mp3Buffer.length,
                    duration: totalDuration,
                    mimeType: "audio/mpeg",
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
                    retryCount: 0,
                    maxRetries: 5,
                  } as Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">);

                  temporaryProcessingJobId = processingJob.id;
                  console.log(
                    `[CompleteUploadVideoV2] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s (before S3 upload)`
                  );
                } catch (error: any) {
                  console.error(`[CompleteUploadVideoV2] Failed to create temporary ProcessingJob early:`, error);
                }
              }
            }
          } catch (error) {
            console.warn(`[CompleteUploadVideoV2] Could not determine duration for single MP3 file:`, error);
          }

          const mp3Key = `users/${userId}/audio/${randomUUID()}-${uploadJob.filename.replace(/\.[^/.]+$/, "")}.mp3`;
          const mp3Stream = Readable.from(mp3Buffer);

          const mp3Result = await this.s3Storage.storeAudio(mp3Stream, s3Bucket, mp3Key, {
            contentType: "audio/mpeg",
            metadata: {
              userId,
              originalFilename: uploadJob.filename,
              type: "audio",
              source: "video-conversion",
            },
            onProgress: async (progress: number) => {
              const totalProgress = 70 + Math.floor(progress * 0.29);
              await this.uploadJobRepository.update(jobId, {
                progress: Math.min(totalProgress, 99),
              });
            },
          });

          s3BucketName = mp3Result.bucket;
          s3Key = mp3Result.key;
        }
      }

      // Generate CDN URL if configured (use original video source if available)
      let generatedCdnUrl: string | undefined;
      // Prefer video source (original mp4) over audio (converted mp3)
      const keyForCdn = videoS3Key || s3Key;
      if (cdnUrl && keyForCdn) {
        const cdnBase = cdnUrl.replace(/\/$/, "");
        // CDN URL format: https://cdn.example.com/key (no bucket name)
        generatedCdnUrl = `${cdnBase}/${keyForCdn}`;
        console.log(`[CompleteUploadVideoV2] Generated CDN URL: ${generatedCdnUrl}`);
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
          filename: uploadJob.filename.replace(/\.[^/.]+$/, "") + ".mp3",
          originalFilename: uploadJob.filename,
          s3Bucket: s3BucketName,
          s3Key,
          parts,
          partCount: parts?.length,
          videoSourceS3Bucket: videoS3BucketName,
          videoSourceS3Key: videoS3Key,
          cdnUrl: generatedCdnUrl,
          audioSourceProvider,
          fileSize: mp3Buffer.length,
          duration: totalDuration,
          mimeType: "audio/mpeg",
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
              retryCount: 0,
              maxRetries: 5,
            } as Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">);
            temporaryProcessingJobId = processingJob.id;
            console.log(
              `[CompleteUploadVideoV2] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s`
            );
          } catch (processingJobError: any) {
            console.error(`[CompleteUploadVideoV2] Failed to create temporary ProcessingJob:`, processingJobError);
          }
        }
      }

      // Delete the temporary upload file from S3
      try {
        await this.s3Storage!.deleteAudio(uploadJob.s3Bucket!, uploadJob.s3Key!);
        console.log(`[CompleteUploadVideoV2] Deleted temporary upload file: ${uploadJob.s3Key}`);
      } catch (deleteError) {
        console.warn(`[CompleteUploadVideoV2] Failed to delete temporary upload file:`, deleteError);
      }

      // Update upload job to completed
      await this.uploadJobRepository.update(jobId, {
        status: "completed",
        progress: 100,
        audioFileId: audioFile.id,
        s3Bucket: s3BucketName,
        s3Key: s3Key,
        completedAt: new Date(),
      });
    } catch (error: any) {
      // Remove temporary ProcessingJob if processing failed
      if (temporaryProcessingJobId) {
        try {
          await this.processingJobRepository.delete(temporaryProcessingJobId);
          console.log(
            `[CompleteUploadVideoV2] Removed temporary ProcessingJob ${temporaryProcessingJobId} due to processing failure`
          );
        } catch (deleteError: any) {
          console.error(
            `[CompleteUploadVideoV2] Failed to remove temporary ProcessingJob ${temporaryProcessingJobId}:`,
            deleteError
          );
        }
      }

      // Remove temporary AudioFile if it was created early
      if (audioFile && (!audioFile.s3Bucket || !audioFile.s3Key)) {
        try {
          await this.audioFileRepository.delete(audioFile.id);
          console.log(`[CompleteUploadVideoV2] Removed temporary AudioFile ${audioFile.id} due to processing failure`);
        } catch (deleteError: any) {
          console.error(`[CompleteUploadVideoV2] Failed to remove temporary AudioFile ${audioFile.id}:`, deleteError);
        }
      }

      console.error(`[CompleteUploadVideoV2] Error in upload job ${jobId}:`, error);
      await this.uploadJobRepository.update(jobId, {
        status: "failed",
        error: error.message || "Unknown error",
        completedAt: new Date(),
      });
      throw error;
    }
  }
}

