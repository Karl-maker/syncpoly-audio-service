export interface UploadJob {
  id: string;
  userId: string;
  audioFileId?: string; // Set when upload completes
  filename: string;
  status: "pending" | "uploading" | "completed" | "failed";
  progress: number; // 0-100
  s3Bucket?: string;
  s3Key?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

