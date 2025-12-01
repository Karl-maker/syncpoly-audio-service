import { AudioSourceProvidersType } from "../enums/audio.source.provider";

export interface AudioFile {
  id: string;
  userId: string;
  filename: string;
  originalFilename: string;
  s3Bucket?: string;
  s3Key?: string;
  audioSourceProvider: AudioSourceProvidersType;
  fileSize: number; // in bytes
  mimeType: string;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

