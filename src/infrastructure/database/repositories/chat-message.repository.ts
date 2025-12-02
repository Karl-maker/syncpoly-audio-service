import { Db } from "mongodb";
import { ChatMessage } from "../../../domain/entities/chat-message";
import { MongoDBRepository } from "../mongodb.repository";
import { TaskRepository } from "./task.repository";
import { QuestionRepository } from "./question.repository";
import { Task } from "../../../domain/entities/task";
import { Question } from "../../../domain/entities/question";

export interface ChatMessageWithEntities extends ChatMessage {
  tasks?: Task[];
  questions?: Question[];
}

export class ChatMessageRepository extends MongoDBRepository<ChatMessage> {
  private taskRepository?: TaskRepository;
  private questionRepository?: QuestionRepository;

  constructor(db: Db, taskRepository?: TaskRepository, questionRepository?: QuestionRepository) {
    super(db, "chatMessages");
    this.taskRepository = taskRepository;
    this.questionRepository = questionRepository;
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

  /**
   * Get messages by audioFileId, sorted newest to oldest
   * @param userId User ID (for security)
   * @param audioFileId Audio file ID to filter by
   * @param limit Maximum number of messages to return (default: 100)
   * @param includeEntities Whether to populate task and question entities (default: true)
   */
  async getMessagesByAudioFileId(
    userId: string,
    audioFileId: string,
    limit: number = 100,
    includeEntities: boolean = true
  ): Promise<ChatMessageWithEntities[]> {
    const filter: Record<string, any> = { 
      userId,
      audioFileId 
    };

    const docs = await this.collection
      .find(filter)
      .sort({ createdAt: -1 }) // Newest first
      .limit(limit)
      .toArray();

    const messages = docs.map((doc) => this.toDomain(doc)) as ChatMessageWithEntities[];

    // Populate task and question entities if repositories are available
    if (includeEntities && (this.taskRepository || this.questionRepository)) {
      // Collect all unique task and question IDs
      const allTaskIds = new Set<string>();
      const allQuestionIds = new Set<string>();
      
      for (const message of messages) {
        if (message.taskIds) {
          message.taskIds.forEach(id => allTaskIds.add(id));
        }
        if (message.questionIds) {
          message.questionIds.forEach(id => allQuestionIds.add(id));
        }
      }

      // Batch fetch all tasks and questions
      const tasksMap = new Map<string, Task>();
      const questionsMap = new Map<string, Question>();

      if (allTaskIds.size > 0 && this.taskRepository) {
        const tasks = await Promise.all(
          Array.from(allTaskIds).map(id => this.taskRepository!.findById(id))
        );
        tasks.forEach(task => {
          if (task) {
            tasksMap.set(task.id, task);
          }
        });
      }

      if (allQuestionIds.size > 0 && this.questionRepository) {
        const questions = await Promise.all(
          Array.from(allQuestionIds).map(id => this.questionRepository!.findById(id))
        );
        questions.forEach(question => {
          if (question) {
            questionsMap.set(question.id, question);
          }
        });
      }

      // Populate each message with its tasks and questions
      for (const message of messages) {
        if (message.taskIds && message.taskIds.length > 0) {
          message.tasks = message.taskIds
            .map(id => tasksMap.get(id))
            .filter((task): task is Task => task !== undefined);
        }

        if (message.questionIds && message.questionIds.length > 0) {
          message.questions = message.questionIds
            .map(id => questionsMap.get(id))
            .filter((question): question is Question => question !== undefined);
        }
      }
    }

    return messages;
  }
}

