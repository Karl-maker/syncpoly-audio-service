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
    this.uploadAudioAsync(uploadJob, file, userId, s3Bucket).catch((error) => {
      console.error(`Upload job ${uploadJob.id} failed:`, error);
    });

    return uploadJob;
  }

  private async uploadAudioAsync(
    uploadJob: UploadJob,
    file: Express.Multer.File,
    userId: string,
    s3Bucket?: string
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

      // Save metadata to database
      const now = new Date();
      const audioFile = await this.audioFileRepository.create({
        userId,
        filename: file.originalname,
        originalFilename: file.originalname,
        s3Bucket: s3BucketName,
        s3Key,
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

