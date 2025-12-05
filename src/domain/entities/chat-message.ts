export interface ChatMessage {
  id: string;
  userId: string;
  audioFileId?: string; // Optional: if conversation is about a specific audio file
  role: "user" | "assistant";
  content: string;
  embeddingId?: string; // ID of the embedding stored in vector store
  taskIds?: string[]; // IDs of tasks associated with this message
  questionIds?: string[]; // IDs of questions associated with this message
  promptTokens?: number; // Number of prompt tokens used (for assistant messages)
  completionTokens?: number; // Number of completion tokens used (for assistant messages)
  totalTokens?: number; // Total tokens used (for assistant messages)
  createdAt: Date;
  updatedAt: Date;
}


