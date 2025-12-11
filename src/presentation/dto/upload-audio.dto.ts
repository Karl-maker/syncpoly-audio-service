export interface UploadAudioRequest {
  file: Express.Multer.File;
}

export interface UploadAudioResponse {
  jobId: string;
  status: "pending" | "uploading" | "converting" | "completed" | "failed";
  message: string;
  audioFileId?: string;
}

export interface InitUploadV2Request {
  filename: string;
  contentType: string;
  fileSize?: number;
}

export interface InitUploadV2Response {
  jobId: string;
  uploadUrl: string;
  s3Key: string;
  s3Bucket: string;
  expiresIn: number;
  status: "pending";
  message: string;
}

export interface CompleteUploadV2Request {
  jobId: string;
}

