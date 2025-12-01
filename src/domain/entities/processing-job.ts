export interface ProcessingJob {
  id: string;
  audioFileId: string;
  userId: string;
  idempotencyKey?: string; // Optional: idempotency key to prevent duplicate processing
  status: "pending" | "processing" | "completed" | "failed";
  progress: number; // 0-100
  transcriptId?: string;
  vectorStoreType?: string; // e.g., "openai", "in-memory"
  options?: Record<string, any>; // Processing options
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

