import { randomUUID } from "crypto";
import { AudioFile } from "../../domain/entities/audio-file";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
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
    private s3Storage?: S3AudioStorage
  ) {}

  async execute(params: UploadAudioUseCaseParams): Promise<AudioFile> {
    const { file, userId, s3Bucket } = params;

    let s3Uri: string | undefined;
    const audioSourceProvider: AudioSourceProvidersType = "s3";

    // Upload to S3 if storage is configured
    if (this.s3Storage && s3Bucket) {
      const { Readable } = await import("stream");
      const fileStream = Readable.from(file.buffer);
      const key = `users/${userId}/${randomUUID()}-${file.originalname}`;
      s3Uri = `s3://${s3Bucket}/${key}`;
      await this.s3Storage.storeAudio(fileStream, s3Uri, {
        contentType: file.mimetype,
        metadata: {
          userId,
          originalFilename: file.originalname,
        },
      });
    }

    // Save metadata to database
    const now = new Date();
    const audioFile = await this.audioFileRepository.create({
      userId,
      filename: file.originalname,
      originalFilename: file.originalname,
      s3Uri,
      audioSourceProvider,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedAt: now,
    } as Omit<AudioFile, "id" | "createdAt" | "updatedAt">);

    return audioFile;
  }
}

