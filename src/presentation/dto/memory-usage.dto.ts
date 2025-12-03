export interface MemoryUsageResponse {
  userId: string;
  totalAudioFiles: number;
  totalStorageBytes: number;
  totalStorageMB: number;
  totalStorageGB: number;
  totalVectorStoreRecords: number;
  vectorStoreMemoryBytes?: number;
  vectorStoreMemoryMB?: number;
  lastCalculatedAt: Date;
}



