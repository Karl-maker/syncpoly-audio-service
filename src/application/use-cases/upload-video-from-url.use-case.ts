import { randomUUID } from "crypto";
import { AudioFile, AudioFilePart } from "../../domain/entities/audio-file";
import { UploadJob } from "../../domain/entities/upload-job";
import { ProcessingJob } from "../../domain/entities/processing-job";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { S3AudioStorage, S3AudioStorageConfig } from "../../infrastructure/aws/s3.audio.storage";
import { VideoConverterService } from "../../infrastructure/video/video-converter.service";
import { VideoDownloadService } from "../../infrastructure/video/video-download.service";
import { AudioSourceProvidersType } from "../../domain/enums/audio.source.provider";
import { AudioChunkingService } from "../../infrastructure/audio/audio-chunking.service";
import { Readable } from "stream";

export interface UploadVideoFromUrlUseCaseParams {
  url: string;
  userId: string;
  sizeLimit?: number; // Optional size limit in seconds (video duration)
  s3Config?: S3AudioStorageConfig;
  s3Bucket?: string;
  cdnUrl?: string; // Optional CDN URL base (e.g., "https://cdn.example.com")
}

export class UploadVideoFromUrlUseCase {
  private videoConverter: VideoConverterService;
  private videoDownloader: VideoDownloadService;
  private chunkingService: AudioChunkingService;
  private readonly CHUNK_SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB

  constructor(
    private audioFileRepository: AudioFileRepository,
    private uploadJobRepository: UploadJobRepository,
    private processingJobRepository: ProcessingJobRepository,
    private s3Storage?: S3AudioStorage
  ) {
    this.videoConverter = new VideoConverterService();
    this.videoDownloader = new VideoDownloadService(s3Storage);
    this.chunkingService = new AudioChunkingService();
  }

  async execute(params: UploadVideoFromUrlUseCaseParams): Promise<UploadJob> {
    const { url, userId, s3Bucket } = params;

    // Validate URL and identify source
    const validation = VideoDownloadService.validateUrl(url);
    if (!validation.valid || !validation.source) {
      throw new Error(validation.error || "Invalid video URL");
    }

    // Create upload job with source URL
    // Filename will be updated once we get the original title from download
    const uploadJob = await this.uploadJobRepository.create({
      userId,
      filename: `video-from-${validation.source}.mp4`, // Temporary, will be updated with actual title
      status: "pending",
      progress: 0,
    } as Omit<UploadJob, "id" | "createdAt" | "updatedAt">);

    // Start download, upload and conversion asynchronously
    this.uploadVideoFromUrlAsync(uploadJob, url, userId, validation.source, s3Bucket, params.cdnUrl, params.sizeLimit).catch(
      async (error) => {
        console.error(`Upload job ${uploadJob.id} failed:`, error);
        await this.uploadJobRepository.update(uploadJob.id, {
          status: "failed",
          error: error.message,
          completedAt: new Date(),
        });
      }
    );

    return uploadJob;
  }

  private async uploadVideoFromUrlAsync(
    uploadJob: UploadJob,
    sourceUrl: string,
    userId: string,
    source: string,
    s3Bucket?: string,
    cdnUrl?: string,
    sizeLimit?: number
  ): Promise<void> {
    const jobId = uploadJob.id;
    let tempDir: string | undefined;
    // Declare variables outside try block so they're accessible in catch block
    let temporaryProcessingJobId: string | undefined;
    let audioFile: AudioFile | undefined;
    
    try {
      // Update job status to downloading
      await this.uploadJobRepository.update(jobId, {
        status: "uploading", // Use "uploading" status for download phase
        startedAt: new Date(),
        progress: 0,
      });

      // Step 1: Download video from URL (0-20% progress)
      console.log(`[UploadVideoFromUrl] Starting download from ${source}: ${sourceUrl}`);
      const downloadResult = await this.videoDownloader.downloadVideo(sourceUrl, async (progress) => {
        // Download is 0-20% of total progress
        await this.uploadJobRepository.update(jobId, {
          progress: Math.floor(progress * 0.2),
        });
      });

      tempDir = downloadResult.filePath.split("/").slice(0, -1).join("/");
      const downloadedFilePath = downloadResult.filePath;
      const videoBuffer = await this.videoDownloader.readVideoFile(downloadedFilePath);

      // Use original title, video ID, or UUID for filename
      // Priority: originalTitle > videoId > UUID
      const originalTitle = downloadResult.originalTitle;
      const videoId = downloadResult.videoId;
      const baseFilename = originalTitle || videoId || randomUUID();
      const downloadedFilename = `${baseFilename}.mp3`; // Will be converted to MP3
      
      // Update upload job filename with the actual title
      if (originalTitle) {
        await this.uploadJobRepository.update(jobId, {
          filename: `${originalTitle}.mp4`,
        });
      }

      // Get duration early from downloadResult if available (before any S3 uploads)
      let totalDuration: number | undefined = downloadResult.duration;
      
      // Check size limit early if duration is available
      if (sizeLimit !== undefined && totalDuration !== undefined) {
        if (totalDuration > sizeLimit) {
          const error = new Error(`Video duration (${totalDuration.toFixed(2)}s) exceeds the size limit (${sizeLimit}s)`);
          (error as any).statusCode = 400;
          throw error;
        }
      }

      // Create temporary AudioFile and ProcessingJob early (before S3 uploads) if duration is known
      if (totalDuration && totalDuration > 0) {
        try {
          audioFile = await this.audioFileRepository.create({
            userId,
            filename: `${baseFilename}.mp3`,
            originalFilename: originalTitle || videoId || baseFilename,
            s3Bucket: undefined, // Placeholder, will be updated
            s3Key: undefined, // Placeholder, will be updated
            parts: undefined, // Will be updated for chunked files
            partCount: undefined,
            videoSourceS3Bucket: undefined, // Will be updated
            videoSourceS3Key: undefined, // Will be updated
            sourceUrl, // Store the original source URL
            cdnUrl: undefined, // Will be updated after upload
            audioSourceProvider: "s3",
            fileSize: 0, // Will be updated after conversion
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
          console.log(`[UploadVideoFromUrl] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s (before S3 uploads)`);
        } catch (error: any) {
          console.error(`[UploadVideoFromUrl] Failed to create temporary ProcessingJob early:`, error);
          // Continue with upload even if ProcessingJob creation fails
        }
      }

      let videoS3BucketName: string | undefined;
      let videoS3Key: string | undefined;
      let s3BucketName: string | undefined;
      let s3Key: string | undefined;
      const audioSourceProvider: AudioSourceProvidersType = "s3";

      // Step 2: Upload original video to S3 (20-40% progress)
      if (this.s3Storage && s3Bucket) {
        // Use original title or UUID for video key
        const videoExtension = downloadResult.filename.split(".").pop() || "mp4";
        const videoKey = `users/${userId}/videos/${baseFilename}.${videoExtension}`;
        const videoStream = this.videoDownloader.createVideoStream(downloadedFilePath);

        const videoResult = await this.s3Storage.storeAudio(
          videoStream,
          s3Bucket,
          videoKey,
          {
            contentType: downloadResult.mimeType,
            metadata: {
              userId,
              originalFilename: originalTitle || downloadedFilename,
              type: "video",
              sourceUrl,
              source,
            },
            onProgress: async (progress: number) => {
              // Video upload is 20-40% of total progress
              await this.uploadJobRepository.update(jobId, {
                progress: 20 + Math.floor(progress * 0.2),
              });
            },
          }
        );

        videoS3BucketName = videoResult.bucket;
        videoS3Key = videoResult.key;

        await this.uploadJobRepository.update(jobId, {
          videoS3Bucket: videoS3BucketName,
          videoS3Key: videoS3Key,
        });
      }

      // Step 3: Convert video to MP3 (40-70% progress)
      await this.uploadJobRepository.update(jobId, {
        status: "converting",
        progress: 40,
      });

      const mp3Buffer = await this.videoConverter.convertVideoToMp3(videoBuffer, {
        onProgress: async (conversionProgress: number) => {
          // Conversion is 40-70% of total progress
          const totalProgress = 40 + Math.floor(conversionProgress * 0.3);
          await this.uploadJobRepository.update(jobId, {
            progress: totalProgress,
          });
        },
      });

      // Step 4: Upload MP3 to S3 (70-100% progress)
      let parts: AudioFilePart[] | undefined;
      const shouldChunk = this.chunkingService.shouldChunkFile(mp3Buffer.length, this.CHUNK_SIZE_THRESHOLD);

      // Update duration if not already set (from chunks or ffprobe)
      if (!totalDuration) {
        totalDuration = downloadResult.duration;
      }

      if (this.s3Storage && s3Bucket) {
        if (shouldChunk) {
          console.log(`[UploadVideoFromUrl] MP3 size ${mp3Buffer.length} exceeds threshold, chunking into parts`);
          
          // Chunk the MP3 into 10MB parts and store each as a separate S3 object
          const chunks = await this.chunkingService.chunkAudioFile(
            mp3Buffer,
            "audio/mpeg",
            {
              chunkSizeBytes: 10 * 1024 * 1024, // 10MB chunks
              onProgress: async (progress: number, partIndex: number) => {
                // Chunking is 70-80% of total progress
                // Progress from chunking service is 0-99%, map to 70-80% of total
                const chunkingProgress = 70 + Math.floor(progress * 0.1);
                await this.uploadJobRepository.update(jobId, {
                  progress: Math.min(chunkingProgress, 79), // Cap at 79% during chunking
                });
              },
            }
          );

          console.log(`[UploadVideoFromUrl] Chunked MP3 into ${chunks.length} parts`);

          // Calculate total duration from chunks if not already set
          if (!totalDuration && chunks.length > 0) {
            totalDuration = chunks[chunks.length - 1].endTimeSec;
            
            // Create temporary AudioFile and ProcessingJob now if not already created (before S3 upload)
            if (!audioFile && totalDuration > 0) {
              try {
                audioFile = await this.audioFileRepository.create({
                  userId,
                  filename: `${baseFilename}.mp3`,
                  originalFilename: originalTitle || videoId || baseFilename,
                  s3Bucket: undefined, // Placeholder, will be updated
                  s3Key: undefined, // Placeholder, will be updated
                  parts: undefined, // Will be updated after upload
                  partCount: chunks.length,
                  videoSourceS3Bucket: videoS3BucketName,
                  videoSourceS3Key: videoS3Key,
                  sourceUrl,
                  cdnUrl: undefined, // Will be updated after upload
                  audioSourceProvider: "s3",
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
                console.log(`[UploadVideoFromUrl] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s (before S3 upload)`);
              } catch (error: any) {
                console.error(`[UploadVideoFromUrl] Failed to create temporary ProcessingJob early:`, error);
              }
            }
          }

          // Check size limit if provided (for chunked upload path)
          if (sizeLimit !== undefined && totalDuration !== undefined) {
            if (totalDuration > sizeLimit) {
              const error = new Error(`Video duration (${totalDuration.toFixed(2)}s) exceeds the size limit (${sizeLimit}s)`);
              (error as any).statusCode = 402;
              throw error;
            }
          }

          // Update progress to 80% when chunking is complete and upload starts
          await this.uploadJobRepository.update(jobId, {
            progress: 80,
          });

          // Upload each 10MB chunk as a separate S3 object
          const fileBaseKey = `users/${userId}/audio/${randomUUID()}-${downloadedFilename.replace(/\.[^/.]+$/, "")}.mp3`;
          parts = [];
          const uploadProgressPerPart = 20 / chunks.length; // 20% for uploads (80-99%)

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const partKey = `${fileBaseKey}-part-${i}`;
            const chunkStream = Readable.from(chunk.buffer);

            const result = await this.s3Storage.storeAudio(
              chunkStream,
              s3Bucket,
              partKey,
              {
                contentType: "audio/mpeg",
                metadata: {
                  userId,
                  originalFilename: originalTitle || downloadedFilename,
                  type: "audio",
                  source: "video-conversion",
                  sourceUrl,
                  partIndex: i.toString(),
                  totalParts: chunks.length.toString(),
                },
                onProgress: async (partProgress: number) => {
                  // Calculate progress: 80% base + progress through all parts
                  // For the last part, cap at 99% to avoid showing 100% before job completion
                  const partProgressValue = (i * uploadProgressPerPart) + (partProgress * uploadProgressPerPart / 100);
                  const totalProgress = 80 + partProgressValue;
                  // Cap at 99% during upload - only set to 100% when job is actually completed
                  await this.uploadJobRepository.update(jobId, {
                    progress: Math.min(Math.floor(totalProgress), 99),
                  });
                },
              }
            );

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
              s3Key = result.key;
            }
          }

          console.log(`[UploadVideoFromUrl] Uploaded ${parts.length} parts`);
        } else {
          // Single file upload
          if (!totalDuration) {
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
              
              // Create temporary AudioFile and ProcessingJob now if not already created (before S3 upload)
              if (!audioFile && totalDuration && totalDuration > 0) {
                try {
                  audioFile = await this.audioFileRepository.create({
                    userId,
                    filename: `${baseFilename}.mp3`,
                    originalFilename: originalTitle || videoId || baseFilename,
                    s3Bucket: undefined, // Placeholder, will be updated
                    s3Key: undefined, // Placeholder, will be updated
                    parts: undefined,
                    partCount: undefined,
                    videoSourceS3Bucket: videoS3BucketName,
                    videoSourceS3Key: videoS3Key,
                    sourceUrl,
                    cdnUrl: undefined, // Will be updated after upload
                    audioSourceProvider: "s3",
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
                  console.log(`[UploadVideoFromUrl] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s (before S3 upload)`);
                } catch (error: any) {
                  console.error(`[UploadVideoFromUrl] Failed to create temporary ProcessingJob early:`, error);
                }
              }
            } catch (error) {
              console.warn(`[UploadVideoFromUrl] Could not determine duration:`, error);
            }
          }

          // Check size limit if provided (for single file upload path)
          if (sizeLimit !== undefined && totalDuration !== undefined) {
            if (totalDuration > sizeLimit) {
              const error = new Error(`Video duration (${totalDuration.toFixed(2)}s) exceeds the size limit (${sizeLimit}s)`);
              (error as any).statusCode = 400;
              throw error;
            }
          }

          // Use original title or UUID for the key
          const mp3Key = `users/${userId}/audio/${baseFilename}.mp3`;
          const mp3Stream = Readable.from(mp3Buffer);

          const mp3Result = await this.s3Storage.storeAudio(
            mp3Stream,
            s3Bucket,
            mp3Key,
            {
              contentType: "audio/mpeg",
              metadata: {
                userId,
                originalFilename: originalTitle || downloadedFilename,
                type: "audio",
                source: "video-conversion",
                sourceUrl,
              },
              onProgress: async (progress: number) => {
                // MP3 upload is 70-99% of total progress (cap at 99% until completion)
                const totalProgress = 70 + Math.floor(progress * 0.29); // 0.29 instead of 0.3 to cap at 99%
                await this.uploadJobRepository.update(jobId, {
                  progress: Math.min(totalProgress, 99),
                });
              },
            }
          );

          s3BucketName = mp3Result.bucket;
          s3Key = mp3Result.key;
        }
      }

      // Generate CDN URL if CDN is configured (use original video source if available)
      let generatedCdnUrl: string | undefined;
      // Prefer video source (original mp4) over audio (converted mp3)
      const keyForCdn = videoS3Key || s3Key;
      if (cdnUrl && keyForCdn) {
        const cdnBase = cdnUrl.replace(/\/$/, "");
        // CDN URL format: https://cdn.example.com/key (no bucket name)
        generatedCdnUrl = `${cdnBase}/${keyForCdn}`;
      }

      // Update AudioFile with S3 info (if created early) or create it now
      if (audioFile) {
        // Update existing AudioFile with S3 info
        await this.audioFileRepository.update(audioFile.id, {
          s3Bucket: s3BucketName,
          s3Key,
          parts,
          partCount: parts?.length,
          videoSourceS3Bucket: videoS3BucketName,
          videoSourceS3Key: videoS3Key,
          cdnUrl: generatedCdnUrl,
          fileSize: mp3Buffer.length,
        });
      } else {
        // Create AudioFile now (if duration wasn't available earlier)
        const audioFilename = `${baseFilename}.mp3`;
        audioFile = await this.audioFileRepository.create({
          userId,
          filename: audioFilename,
          originalFilename: originalTitle || videoId || baseFilename,
          s3Bucket: s3BucketName,
          s3Key,
          parts,
          partCount: parts?.length,
          videoSourceS3Bucket: videoS3BucketName,
          videoSourceS3Key: videoS3Key,
          sourceUrl,
          cdnUrl: generatedCdnUrl,
          audioSourceProvider,
          fileSize: mp3Buffer.length,
          duration: totalDuration,
          mimeType: "audio/mpeg",
          uploadedAt: new Date(),
        } as Omit<AudioFile, "id" | "createdAt" | "updatedAt">);

        // Create temporary ProcessingJob if duration is known
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
            console.log(`[UploadVideoFromUrl] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s`);
          } catch (processingJobError: any) {
            console.error(`[UploadVideoFromUrl] Failed to create temporary ProcessingJob:`, processingJobError);
          }
        }
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
      // Remove temporary ProcessingJob if upload failed
      if (temporaryProcessingJobId) {
        try {
          await this.processingJobRepository.delete(temporaryProcessingJobId);
          console.log(`[UploadVideoFromUrl] Removed temporary ProcessingJob ${temporaryProcessingJobId} due to upload failure`);
        } catch (deleteError: any) {
          console.error(`[UploadVideoFromUrl] Failed to remove temporary ProcessingJob ${temporaryProcessingJobId}:`, deleteError);
        }
      }
      
      // Remove temporary AudioFile if it was created early
      if (audioFile && (!audioFile.s3Bucket || !audioFile.s3Key)) {
        try {
          await this.audioFileRepository.delete(audioFile.id);
          console.log(`[UploadVideoFromUrl] Removed temporary AudioFile ${audioFile.id} due to upload failure`);
        } catch (deleteError: any) {
          console.error(`[UploadVideoFromUrl] Failed to remove temporary AudioFile ${audioFile.id}:`, deleteError);
        }
      }

      console.error(`[UploadVideoFromUrl] Error in upload job ${jobId}:`, error);
      await this.uploadJobRepository.update(jobId, {
        status: "failed",
        error: error.message || "Unknown error",
        completedAt: new Date(),
      });
      throw error;
    } finally {
      // Clean up temporary files
      if (tempDir) {
        await this.videoDownloader.cleanupTempDir(tempDir).catch((error) => {
          console.error(`[UploadVideoFromUrl] Error cleaning up temp directory:`, error);
        });
      }
    }
  }
}

