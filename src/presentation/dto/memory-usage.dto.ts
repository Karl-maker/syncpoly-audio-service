import { ProcessLogEntry } from "../../domain/entities/memory-usage";

export interface MemoryUsageResponse {
  userId: string;
  totalAudioFiles: number;
  totalStorageBytes: number;
  totalStorageMB: number;
  totalStorageGB: number;
  totalVectorStoreRecords: number;
  vectorStoreMemoryBytes?: number;
  vectorStoreMemoryMB?: number;
  totalAudioProcessedSeconds: number;
  totalAudioProcessedMinutes: number;
  totalAICreditsUsed: number; // Credits from audio processing
  totalChatTokens?: number; // Total tokens used in chat interactions
  totalChatCreditsUsed?: number; // Credits used for chat (calculated from tokens)
  provider: string;
  processLog: ProcessLogEntry[];
  lastCalculatedAt: Date;
}

export interface UsagePeriodResponse {
  userId: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  totalStorageBytes: number;
  totalStorageMB: number;
  totalStorageGB: number;
  totalAudioProcessedSeconds: number;
  totalAudioProcessedMinutes: number;
  totalAICreditsUsed: number; // Credits from audio processing
  totalChatTokens?: number; // Total tokens used in chat interactions
  totalChatCreditsUsed?: number; // Credits used for chat (calculated from tokens)
  provider: string;
  processLog: ProcessLogEntry[];
  calculatedAt: Date;
}




