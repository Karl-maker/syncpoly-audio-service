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

export interface UploadVideoUseCaseParams {
  file: Express.Multer.File;
  userId: string;
  s3Config?: S3AudioStorageConfig;
  s3Bucket?: string;
  cdnUrl?: string; // Optional CDN URL base (e.g., "https://cdn.example.com")
}

export class UploadVideoUseCase {
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

  async execute(params: UploadVideoUseCaseParams): Promise<UploadJob> {
    const { file, userId, s3Bucket } = params;

    // Verify it's a video file
    if (!this.videoConverter.isVideoFile(file.mimetype)) {
      throw new Error(`File is not a video. MIME type: ${file.mimetype}`);
    }

    // Create upload job
    const uploadJob = await this.uploadJobRepository.create({
      userId,
      filename: file.originalname,
      status: "pending",
      progress: 0,
    } as Omit<UploadJob, "id" | "createdAt" | "updatedAt">);

    // Start upload and conversion asynchronously
    this.uploadVideoAsync(uploadJob, file, userId, s3Bucket, params.cdnUrl).catch(
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

  private async uploadVideoAsync(
    uploadJob: UploadJob,
    file: Express.Multer.File,
    userId: string,
    s3Bucket?: string,
    cdnUrl?: string
  ): Promise<void> {
    const jobId = uploadJob.id; // Declare outside try block so it's accessible in catch
    // Declare variables outside try block so they're accessible in catch block
    let temporaryProcessingJobId: string | undefined;
    let audioFile: AudioFile | undefined;
    
    try {
      // Update job status to uploading
      await this.uploadJobRepository.update(jobId, {
        status: "uploading",
        startedAt: new Date(),
        progress: 0,
      });

      let videoS3BucketName: string | undefined;
      let videoS3Key: string | undefined;
      let s3BucketName: string | undefined;
      let s3Key: string | undefined;
      const audioSourceProvider: AudioSourceProvidersType = "s3";

      // Step 1: Upload video to S3 (0-30% progress)
      if (this.s3Storage && s3Bucket) {
        const videoKey = `users/${userId}/videos/${randomUUID()}-${file.originalname}`;
        const videoStream = Readable.from(file.buffer);

        const videoResult = await this.s3Storage.storeAudio(
          videoStream,
          s3Bucket,
          videoKey,
          {
            contentType: file.mimetype,
            metadata: {
              userId,
              originalFilename: file.originalname,
              type: "video",
            },
            onProgress: async (progress: number) => {
              // Video upload is 0-30% of total progress
              await this.uploadJobRepository.update(jobId, {
                progress: Math.floor(progress * 0.3),
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

      // Step 2: Convert video to MP3 (30-70% progress)
      await this.uploadJobRepository.update(jobId, {
        status: "converting",
        progress: 30,
      });

      const mp3Buffer = await this.videoConverter.convertVideoToMp3(file.buffer, {
        onProgress: async (conversionProgress: number) => {
          // Conversion is 30-70% of total progress
          const totalProgress = 30 + Math.floor(conversionProgress * 0.4);
          await this.uploadJobRepository.update(jobId, {
            progress: totalProgress,
          });
        },
      });

      // Step 3: Upload MP3 to S3 (70-100% progress)
      let parts: AudioFilePart[] | undefined;
      let totalDuration: number | undefined;
      const shouldChunk = this.chunkingService.shouldChunkFile(mp3Buffer.length, this.CHUNK_SIZE_THRESHOLD);

      if (this.s3Storage && s3Bucket) {
        if (shouldChunk) {
          console.log(`[UploadVideo] MP3 size ${mp3Buffer.length} exceeds threshold, chunking into parts`);
          
          // Chunk the MP3 into 10MB parts and store each as a separate S3 object
          const chunks = await this.chunkingService.chunkAudioFile(
            mp3Buffer,
            "audio/mpeg",
            {
              chunkSizeBytes: 10 * 1024 * 1024, // 10MB chunks (well under OpenAI's 25MB limit)
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

          console.log(`[UploadVideo] Chunked MP3 into ${chunks.length} parts`);

          // Calculate total duration from chunks (last chunk's endTimeSec) - before S3 upload
          totalDuration = chunks.length > 0 ? chunks[chunks.length - 1].endTimeSec : undefined;
          if (totalDuration) {
            console.log(`[UploadVideo] Total duration (from chunks, before S3 upload): ${totalDuration.toFixed(2)} seconds`);
            
            // Create temporary AudioFile and ProcessingJob now (before S3 upload)
            if (totalDuration > 0) {
              try {
                audioFile = await this.audioFileRepository.create({
                  userId,
                  filename: file.originalname.replace(/\.[^/.]+$/, "") + ".mp3",
                  originalFilename: file.originalname,
                  s3Bucket: undefined, // Placeholder, will be updated
                  s3Key: undefined, // Placeholder, will be updated
                  parts: undefined, // Will be updated after upload
                  partCount: chunks.length,
                  videoSourceS3Bucket: videoS3BucketName,
                  videoSourceS3Key: videoS3Key,
                  cdnUrl: undefined, // Will be updated after upload
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
                console.log(`[UploadVideo] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s (before S3 upload)`);
              } catch (error: any) {
                console.error(`[UploadVideo] Failed to create temporary ProcessingJob early:`, error);
              }
            }
          }

          // Update progress to 80% when chunking is complete and upload starts
          await this.uploadJobRepository.update(jobId, {
            progress: 80,
          });

          // Upload each 10MB chunk as a separate S3 object
          // Each part is stored independently in S3 for direct processing later
          const fileBaseKey = `users/${userId}/audio/${randomUUID()}-${file.originalname.replace(/\.[^/.]+$/, "")}.mp3`;
          parts = [];
          const uploadProgressPerPart = 20 / chunks.length; // 20% for uploads (80-99%)

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            // Each chunk gets its own unique S3 key: {baseKey}-part-{index}
            const partKey = `${fileBaseKey}-part-${i}`;
            const chunkStream = Readable.from(chunk.buffer);

            // Store each chunk as a separate S3 object
            const result = await this.s3Storage.storeAudio(
              chunkStream,
              s3Bucket,
              partKey,
              {
                contentType: "audio/mpeg",
                metadata: {
                  userId,
                  originalFilename: file.originalname,
                  type: "audio",
                  source: "video-conversion",
                  partIndex: i.toString(),
                  totalParts: chunks.length.toString(),
                },
                onProgress: async (partProgress: number) => {
                  // Upload progress for this part: 80% base + progress through all parts
                  // Calculate progress through this specific part
                  const partProgressValue = (i * uploadProgressPerPart) + (partProgress * uploadProgressPerPart / 100);
                  const totalProgress = 80 + partProgressValue;
                  // Cap at 99% during upload - only set to 100% when job is actually completed
                  await this.uploadJobRepository.update(jobId, {
                    progress: Math.min(Math.floor(totalProgress), 99),
                  });
                },
              }
            );

            // Generate CDN URL for this part if CDN is configured
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

            // Set bucket and first key for backward compatibility
            if (i === 0) {
              s3BucketName = result.bucket;
              s3Key = result.key;
            }
          }

          console.log(`[UploadVideo] Uploaded ${parts.length} parts`);
        } else {
          // Single file upload (backward compatible)
          // Get duration for single MP3 file using ffprobe (before S3 upload)
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
              console.log(`[UploadVideo] Single MP3 file duration (before S3 upload): ${totalDuration.toFixed(2)} seconds`);
              
              // Create temporary AudioFile and ProcessingJob now (before S3 upload)
              if (totalDuration > 0) {
                try {
                  audioFile = await this.audioFileRepository.create({
                    userId,
                    filename: file.originalname.replace(/\.[^/.]+$/, "") + ".mp3",
                    originalFilename: file.originalname,
                    s3Bucket: undefined, // Placeholder, will be updated
                    s3Key: undefined, // Placeholder, will be updated
                    parts: undefined,
                    partCount: undefined,
                    videoSourceS3Bucket: videoS3BucketName,
                    videoSourceS3Key: videoS3Key,
                    cdnUrl: undefined, // Will be updated after upload
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
                  console.log(`[UploadVideo] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s (before S3 upload)`);
                } catch (error: any) {
                  console.error(`[UploadVideo] Failed to create temporary ProcessingJob early:`, error);
                }
              }
            }
          } catch (error) {
            console.warn(`[UploadVideo] Could not determine duration for single MP3 file:`, error);
          }

          const mp3Key = `users/${userId}/audio/${randomUUID()}-${file.originalname.replace(/\.[^/.]+$/, "")}.mp3`;
          const mp3Stream = Readable.from(mp3Buffer);

          const mp3Result = await this.s3Storage.storeAudio(
            mp3Stream,
            s3Bucket,
            mp3Key,
            {
              contentType: "audio/mpeg",
              metadata: {
                userId,
                originalFilename: file.originalname,
                type: "audio",
                source: "video-conversion",
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
        console.log(`[UploadVideo] Generated CDN URL: ${generatedCdnUrl}`);
      }

      // Update AudioFile with S3 info (if created early) or create it now
      if (audioFile) {
        // Update existing AudioFile with S3 info
        await this.audioFileRepository.update(audioFile.id, {
          s3Bucket: s3BucketName,
          s3Key, // Backward compatibility: points to first part
          parts, // Array of parts for chunked uploads
          partCount: parts?.length,
          cdnUrl: generatedCdnUrl, // CDN URL for first part or single file
        });
      } else {
        // Create AudioFile now (if duration wasn't available earlier)
        audioFile = await this.audioFileRepository.create({
          userId,
          filename: file.originalname.replace(/\.[^/.]+$/, "") + ".mp3",
          originalFilename: file.originalname,
          s3Bucket: s3BucketName,
          s3Key, // Backward compatibility: points to first part
          parts, // Array of parts for chunked uploads
          partCount: parts?.length,
          videoSourceS3Bucket: videoS3BucketName,
          videoSourceS3Key: videoS3Key,
          cdnUrl: generatedCdnUrl, // CDN URL for first part or single file
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
            console.log(`[UploadVideo] Created temporary ProcessingJob ${temporaryProcessingJobId} for audioFile ${audioFile.id} with duration ${totalDuration.toFixed(2)}s`);
          } catch (processingJobError: any) {
            console.error(`[UploadVideo] Failed to create temporary ProcessingJob:`, processingJobError);
          }
        }
      }

      // Update upload job to completed and link to audio file
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
          console.log(`[UploadVideo] Removed temporary ProcessingJob ${temporaryProcessingJobId} due to upload failure`);
        } catch (deleteError: any) {
          console.error(`[UploadVideo] Failed to remove temporary ProcessingJob ${temporaryProcessingJobId}:`, deleteError);
        }
      }
      
      // Remove temporary AudioFile if it was created early
      if (audioFile && (!audioFile.s3Bucket || !audioFile.s3Key)) {
        try {
          await this.audioFileRepository.delete(audioFile.id);
          console.log(`[UploadVideo] Removed temporary AudioFile ${audioFile.id} due to upload failure`);
        } catch (deleteError: any) {
          console.error(`[UploadVideo] Failed to remove temporary AudioFile ${audioFile.id}:`, deleteError);
        }
      }

      console.error(`[UploadVideo] Error in upload job ${jobId}:`, error);
      await this.uploadJobRepository.update(jobId, {
        status: "failed",
        error: error.message || "Unknown error",
        completedAt: new Date(),
      });
      throw error;
    }
  }
}

