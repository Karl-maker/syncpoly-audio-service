export interface ChatMessage {
  id: string;
  userId: string;
  audioFileId?: string; // Optional: if conversation is about a specific audio file
  role: "user" | "assistant";
  content: string;
  embeddingId?: string; // ID of the embedding stored in vector store
  createdAt: Date;
  updatedAt: Date;
}

