export interface UploadAudioRequest {
  file: Express.Multer.File;
}

export interface UploadAudioResponse {
  jobId: string;
  status: "pending" | "uploading" | "completed" | "failed";
  message: string;
  audioFileId?: string;
}

