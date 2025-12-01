export interface ProcessAudioRequest {
  audioFileId: string;
  vectorStoreType?: "mongodb" | "openai" | "in-memory"; // "mongodb" is the default and recommended option
  skipTranscription?: boolean;
  skipEmbeddings?: boolean;
  skipVectorStore?: boolean;
  options?: Record<string, any>;
}

export interface ProcessAudioResponse {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcriptId?: string;
  message?: string;
}

