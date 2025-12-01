import { AudioSourceProvidersType } from "../enums/audio.source.provider";

export interface AudioFile {
  id: string;
  userId: string;
  filename: string;
  originalFilename: string;
  s3Uri?: string; // s3://bucket/key format
  audioSourceProvider: AudioSourceProvidersType;
  fileSize: number; // in bytes
  mimeType: string;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

