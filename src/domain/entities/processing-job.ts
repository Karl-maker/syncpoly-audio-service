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
  processedParts?: number[]; // Array of part indices that have been successfully processed
  lastProcessedPartIndex?: number; // Last part index that was processed (for resuming)
  createdAt: Date;
  updatedAt: Date;
}

