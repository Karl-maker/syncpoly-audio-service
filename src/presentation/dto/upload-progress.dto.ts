export interface UploadProgressResponse {
  jobId: string;
  status: "pending" | "uploading" | "converting" | "completed" | "failed";
  progress: number; // 0-100
  audioFileId?: string;
  filename: string;
  s3Bucket?: string;
  s3Key?: string;
  videoS3Bucket?: string; // S3 bucket for video file (if video upload)
  videoS3Key?: string; // S3 key for video file (if video upload)
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

