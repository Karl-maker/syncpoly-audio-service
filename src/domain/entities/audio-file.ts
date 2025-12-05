import { AudioSourceProvidersType } from "../enums/audio.source.provider";

export interface AudioFilePart {
  s3Key: string;
  partIndex: number;
  fileSize: number; // Size of this part in bytes
  cdnUrl?: string; // Optional CDN URL for this part
}

export interface AudioFile {
  id: string;
  userId: string;
  filename: string;
  originalFilename: string;
  s3Bucket?: string;
  s3Key?: string; // Deprecated: kept for backward compatibility, points to first part if parts exist
  parts?: AudioFilePart[]; // Array of parts for chunked uploads
  partCount?: number; // Number of parts (for quick reference)
  videoSourceS3Bucket?: string; // Optional: S3 bucket for original video file
  videoSourceS3Key?: string; // Optional: S3 key for original video file
  sourceUrl?: string; // Optional: URL source for videos downloaded from YouTube, TikTok, Instagram, or Facebook
  cdnUrl?: string; // Optional CDN URL for playback (first part or combined)
  audioSourceProvider: AudioSourceProvidersType;
  fileSize: number; // Total file size in bytes (sum of all parts)
  duration?: number; // Total duration in seconds (sum of all parts)
  mimeType: string;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

