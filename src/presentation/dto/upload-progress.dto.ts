export interface UploadProgressResponse {
  jobId: string;
  status: "pending" | "uploading" | "completed" | "failed";
  progress: number; // 0-100
  audioFileId?: string;
  filename: string;
  s3Bucket?: string;
  s3Key?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

