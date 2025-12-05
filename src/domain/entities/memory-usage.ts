export interface ProcessLogEntry {
  date: Date;
  audioFileId: string;
  audioFilename: string;
  audioProcessedSeconds: number; // Length of audio processed in seconds
  aiCreditsUsed: number; // AI credits used for this process
  provider: string; // e.g., 'openai'
  status: 'completed' | 'failed';
  processingJobId: string;
}

export interface MemoryUsage {
  userId: string;
  totalAudioFiles: number;
  totalStorageBytes: number; // Total storage used in bytes
  totalVectorStoreRecords: number;
  vectorStoreMemoryBytes?: number; // Estimated memory for vector store
  totalAudioProcessedSeconds: number; // Total length of audio processed (transcribed) in seconds
  totalAICreditsUsed: number; // Total AI credits used (from audio processing)
  totalChatTokens?: number; // Total tokens used in chat interactions
  totalChatCreditsUsed?: number; // Total credits used for chat (calculated from tokens)
  provider: string; // AI provider used (e.g., 'openai')
  processLog: ProcessLogEntry[]; // Log of all processes with dates
  lastCalculatedAt: Date;
}




