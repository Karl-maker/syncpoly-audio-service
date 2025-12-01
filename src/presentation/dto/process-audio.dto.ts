export interface ProcessAudioRequest {
  audioFileId: string;
  vectorStoreType?: "openai" | "in-memory";
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

