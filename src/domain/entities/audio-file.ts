import { AudioSourceProvidersType } from "../enums/audio.source.provider";

export interface AudioFile {
  id: string;
  userId: string;
  filename: string;
  originalFilename: string;
  s3Bucket?: string;
  s3Key?: string;
  videoSourceS3Bucket?: string; // Optional: S3 bucket for original video file
  videoSourceS3Key?: string; // Optional: S3 key for original video file
  cdnUrl?: string; // Optional CDN URL for playback
  audioSourceProvider: AudioSourceProvidersType;
  fileSize: number; // in bytes
  mimeType: string;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

