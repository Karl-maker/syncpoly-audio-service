export interface ChatRequest {
  message: string;
  audioFileId?: string; // Optional: if provided, only search within this audio file
  topK?: number; // Number of relevant chunks to retrieve (default: 10, recommended: 5-20)
}

export interface ChatResponse {
  // Streaming response - no body needed, will stream text
}

