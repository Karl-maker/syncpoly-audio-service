export interface UploadAudioRequest {
  file: Express.Multer.File;
}

export interface UploadAudioResponse {
  id: string;
  filename: string;
  s3Uri?: string;
  fileSize: number;
  uploadedAt: Date;
}

