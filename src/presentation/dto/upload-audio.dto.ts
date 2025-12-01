export interface UploadAudioRequest {
  file: Express.Multer.File;
}

export interface UploadAudioResponse {
  jobId: string;
  status: "pending" | "uploading" | "converting" | "completed" | "failed";
  message: string;
  audioFileId?: string;
}

