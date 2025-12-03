export interface ProcessingProgressResponse {
  jobId: string;
  audioFileId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number; // 0-100
  transcriptId?: string;
  vectorStoreType?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}




