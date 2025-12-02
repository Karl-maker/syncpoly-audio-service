export interface ChatMessage {
  id: string;
  userId: string;
  audioFileId?: string; // Optional: if conversation is about a specific audio file
  role: "user" | "assistant";
  content: string;
  embeddingId?: string; // ID of the embedding stored in vector store
  taskIds?: string[]; // IDs of tasks associated with this message
  questionIds?: string[]; // IDs of questions associated with this message
  createdAt: Date;
  updatedAt: Date;
}


