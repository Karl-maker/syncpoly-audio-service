import { randomUUID } from "crypto";
import { AudioFile } from "../../domain/entities/audio-file";
import { UploadJob } from "../../domain/entities/upload-job";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { S3AudioStorage, S3AudioStorageConfig } from "../../infrastructure/aws/s3.audio.storage";
import { VideoConverterService } from "../../infrastructure/video/video-converter.service";
import { AudioSourceProvidersType } from "../../domain/enums/audio.source.provider";
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

  constructor(
    private audioFileRepository: AudioFileRepository,
    private uploadJobRepository: UploadJobRepository,
    private s3Storage?: S3AudioStorage
  ) {
    this.videoConverter = new VideoConverterService();
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
      if (this.s3Storage && s3Bucket) {
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
              // MP3 upload is 70-100% of total progress
              const totalProgress = 70 + Math.floor(progress * 0.3);
              await this.uploadJobRepository.update(jobId, {
                progress: totalProgress,
              });
            },
          }
        );

        s3BucketName = mp3Result.bucket;
        s3Key = mp3Result.key;
      }

      // Generate CDN URL if CDN is configured
      let generatedCdnUrl: string | undefined;
      if (cdnUrl && s3BucketName && s3Key) {
        const cdnBase = cdnUrl.replace(/\/$/, "");
        generatedCdnUrl = `${cdnBase}/${s3BucketName}/${s3Key}`;
        console.log(`[UploadVideo] Generated CDN URL: ${generatedCdnUrl}`);
      }

      // Save metadata to database
      const now = new Date();
      const audioFile = await this.audioFileRepository.create({
        userId,
        filename: file.originalname.replace(/\.[^/.]+$/, "") + ".mp3",
        originalFilename: file.originalname,
        s3Bucket: s3BucketName,
        s3Key,
        videoSourceS3Bucket: videoS3BucketName,
        videoSourceS3Key: videoS3Key,
        audioSourceProvider,
        fileSize: mp3Buffer.length,
        mimeType: "audio/mpeg",
        uploadedAt: now,
      } as Omit<AudioFile, "id" | "createdAt" | "updatedAt">);

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

