import { Db } from "mongodb";
import { ChatMessage } from "../../../domain/entities/chat-message";
import { MongoDBRepository } from "../mongodb.repository";

export class ChatMessageRepository extends MongoDBRepository<ChatMessage> {
  constructor(db: Db) {
    super(db, "chatMessages");
  }

  protected toDomain(doc: Record<string, any>): ChatMessage {
    const { _id, ...rest } = doc;
    // Use id field if present, otherwise fall back to _id for backward compatibility
    const id = rest.id || _id?.toString();
    return { ...rest, id } as ChatMessage;
  }

  /**
   * Get recent conversation history for a user
   * @param userId User ID
   * @param audioFileId Optional: filter by specific audio file
   * @param limit Maximum number of messages to return (default: 50)
   */
  async getRecentConversation(
    userId: string,
    audioFileId?: string,
    limit: number = 50
  ): Promise<ChatMessage[]> {
    const filter: Record<string, any> = { userId };
    if (audioFileId) {
      filter.audioFileId = audioFileId;
    }

    const docs = await this.collection
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((doc) => this.toDomain(doc)).reverse(); // Reverse to get chronological order
  }

  /**
   * Get conversation history for building context
   * Returns messages in chronological order
   */
  async getConversationHistory(
    userId: string,
    audioFileId?: string,
    limit: number = 20
  ): Promise<ChatMessage[]> {
    return this.getRecentConversation(userId, audioFileId, limit);
  }
}

