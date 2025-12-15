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
  lang?: string; // ISO-639-1 language code for transcription
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  processedParts?: number[]; // Array of part indices that have been successfully processed
  lastProcessedPartIndex?: number; // Last part index that was processed (for resuming)
  lockedAt?: Date; // When the lock was acquired
  lockedBy?: string; // Identifier for what's holding the lock (process ID, instance ID, etc.)
  lockTimeout?: number; // Lock timeout in milliseconds (default: 5 minutes)
  retryCount?: number; // Number of retry attempts
  maxRetries?: number; // Maximum number of retries allowed (default: 5)
  lastRetryAt?: Date; // When the last retry was attempted
  createdAt: Date;
  updatedAt: Date;
}

