import { randomUUID } from "crypto";
import { AudioFile } from "../../domain/entities/audio-file";
import { UploadJob } from "../../domain/entities/upload-job";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { S3AudioStorage, S3AudioStorageConfig } from "../../infrastructure/aws/s3.audio.storage";
import { AudioSourceProvidersType } from "../../domain/enums/audio.source.provider";

export interface UploadAudioUseCaseParams {
  file: Express.Multer.File;
  userId: string;
  s3Config?: S3AudioStorageConfig;
  s3Bucket?: string;
  cdnUrl?: string; // Optional CDN URL base (e.g., "https://cdn.example.com")
}

export class UploadAudioUseCase {
  constructor(
    private audioFileRepository: AudioFileRepository,
    private uploadJobRepository: UploadJobRepository,
    private s3Storage?: S3AudioStorage
  ) {}

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
      const audioSourceProvider: AudioSourceProvidersType = "s3";

      // Upload to S3 if storage is configured
      if (this.s3Storage && s3Bucket) {
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
              // Update progress in database
              await this.uploadJobRepository.update(uploadJob.id, {
                progress,
              });
            },
          }
        );

        s3BucketName = result.bucket;
        s3Key = result.key;
      }

      // Generate CDN URL if CDN is configured
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
        s3Key,
        cdnUrl: generatedCdnUrl,
        audioSourceProvider,
        fileSize: file.size,
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

