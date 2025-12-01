export interface ProcessingJob {
  id: string;
  audioFileId: string;
  userId: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcriptId?: string;
  vectorStoreType?: string; // e.g., "openai", "in-memory"
  options?: Record<string, any>; // Processing options
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

