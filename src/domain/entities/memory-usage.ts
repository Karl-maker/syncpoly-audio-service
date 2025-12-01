export interface MemoryUsage {
  userId: string;
  totalAudioFiles: number;
  totalStorageBytes: number; // Total storage used in bytes
  totalVectorStoreRecords: number;
  vectorStoreMemoryBytes?: number; // Estimated memory for vector store
  lastCalculatedAt: Date;
}

