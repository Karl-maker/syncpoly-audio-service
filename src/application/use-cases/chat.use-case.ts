import OpenAI from "openai";
import { IEmbeddingProvider } from "../../domain/interfaces/iembedding.provider";
import { IVectorStore } from "../../domain/interfaces/ivector.store";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { ChatMessageRepository } from "../../infrastructure/database/repositories/chat-message.repository";
import { TaskRepository } from "../../infrastructure/database/repositories/task.repository";
import { QuestionRepository } from "../../infrastructure/database/repositories/question.repository";
import { CustomerRepository } from "../../infrastructure/database/repositories/customer.repository";
import { StructuredExtractionService } from "../services/structured-extraction.service";
import { TokenCounterService } from "../../infrastructure/openai/token-counter.service";
import { AudioFile } from "../../domain/entities/audio-file";
import { Task } from "../../domain/entities/task";
import { Question } from "../../domain/entities/question";

export interface ChatUseCaseParams {
  userId: string;
  message: string;
  audioFileId?: string; // Single audio file ID (for backwards compatibility)
  audioFileIds?: string[]; // Multiple audio file IDs
  topK?: number;
}

export interface ChatUseCaseResult {
  content: string;
  tasks?: Task[];
  questions?: Question[];
}

export class ChatUseCase {
  private openaiClient: OpenAI;
  private extractionService: StructuredExtractionService;

  constructor(
    private embeddingProvider: IEmbeddingProvider,
    private vectorStore: IVectorStore,
    private audioFileRepository: AudioFileRepository,
    private chatMessageRepository: ChatMessageRepository,
    private taskRepository: TaskRepository,
    private questionRepository: QuestionRepository,
    private customerRepository: CustomerRepository,
    openaiApiKey: string
  ) {
    this.openaiClient = new OpenAI({ apiKey: openaiApiKey });
    this.extractionService = new StructuredExtractionService(openaiApiKey);
  }

  async *execute(params: ChatUseCaseParams): AsyncGenerator<string | ChatUseCaseResult, void, unknown> {
    // Default topK to 10 for better results, especially when filtering
    const { userId, message, audioFileId, audioFileIds, topK = 10 } = params;

    // Get user's name from customer record
    let userName: string | undefined;
    try {
      const customer = await this.customerRepository.findOneByUserId(userId);
      userName = customer?.name;
    } catch (error) {
      console.warn(`[Chat] Could not fetch customer name for userId ${userId}:`, error);
    }

    // Normalize audio file IDs: support both single audioFileId (backwards compatible) and multiple audioFileIds
    const targetAudioFileIds: string[] = [];
    if (audioFileIds && audioFileIds.length > 0) {
      // Use multiple audio file IDs if provided
      targetAudioFileIds.push(...audioFileIds);
    } else if (audioFileId) {
      // Fall back to single audioFileId for backwards compatibility
      targetAudioFileIds.push(audioFileId);
    }

    // Efficiently fetch only the specified audio files and verify ownership
    let targetAudioFiles: AudioFile[] = [];
    let userAudioFiles: AudioFile[] = [];
    
    if (targetAudioFileIds.length > 0) {
      // Fetch only the specified audio files by ID (more efficient)
      targetAudioFiles = await this.audioFileRepository.findByIds(targetAudioFileIds);
      
      // Verify all files exist and belong to the user
      if (targetAudioFiles.length !== targetAudioFileIds.length) {
        const foundIds = new Set(targetAudioFiles.map(f => f.id));
        const missingIds = targetAudioFileIds.filter(id => !foundIds.has(id));
        throw new Error(`Audio file(s) not found: ${missingIds.join(", ")}`);
      }
      
      // Verify all files belong to the user
      for (const file of targetAudioFiles) {
        if (file.userId !== userId) {
          throw new Error(`Audio file ${file.id} is not authorized for this user`);
        }
      }
      
      // Use the fetched files for building audioSourceIds
      userAudioFiles = targetAudioFiles;
    } else {
      // No specific files requested: fetch all user's audio files
      userAudioFiles = await this.audioFileRepository.findByUserId(userId);
    }
    
    // Build audioSourceId format: "bucket/key" (matches what IAudioSource.getId() returns)
    const audioSourceIds = userAudioFiles
      .filter((f) => f.s3Bucket && f.s3Key)
      .map((f) => `${f.s3Bucket}/${f.s3Key}`);

    if (audioSourceIds.length === 0) {
      throw new Error("No audio files found for user");
    }

    // Store user message (use first audioFileId for backwards compatibility with existing schema)
    const userMessage = await this.chatMessageRepository.create({
      userId,
      audioFileId: targetAudioFileIds.length > 0 ? targetAudioFileIds[0] : undefined,
      role: "user",
      content: message,
    });

    // Get last 10 messages for conversation context (excluding current message)
    // For multiple audio files, we'll search across all of them
    const conversationHistory = await this.chatMessageRepository.getConversationHistory(
      userId,
      targetAudioFileIds.length > 0 ? targetAudioFileIds[0] : undefined,
      10
    );

    // Embed the user's query for audio search
    const [queryEmbedding] = await this.embeddingProvider.embedTexts([
      { id: "query", text: message },
    ]);

    // Build search filter with userId (required) and optional audioFileId(s)
    // Only search audio embeddings (not conversation messages)
    const searchFilter: Record<string, any> = {
      userId: userId, // Always filter by userId for security
    };
    
    if (targetAudioFileIds.length > 0) {
      // Filter by specific audio file(s)
      if (targetAudioFileIds.length === 1) {
        // Single audio file: use both audioFileId and audioSourceId for backwards compatibility
        searchFilter.audioFileId = targetAudioFileIds[0];
        if (audioSourceIds.length > 0) {
          searchFilter.audioSourceId = audioSourceIds[0];
        }
      } else {
        // Multiple audio files: use $in operator for audioFileId
        searchFilter.audioFileIds = targetAudioFileIds;
        // Also include audioSourceIds for filtering
        if (audioSourceIds.length > 0) {
          searchFilter.audioSourceIds = audioSourceIds;
        }
      }
    }

    console.log(`[Chat] Searching audio vector store for query: "${message}" with filter:`, searchFilter);

    const searchResults = await this.vectorStore.search(
      queryEmbedding.embedding,
      topK,
      searchFilter
    );

    console.log(`[Chat] Found ${searchResults.length} audio search results`);

    // Results are already filtered by the vector store, but double-check for security
    const relevantChunks = searchResults.filter((r) => {
      // Ensure userId matches (security check)
      if (r.metadata.userId !== userId) return false;
      
      if (targetAudioFileIds.length > 0) {
        // For specific audio file(s), ensure it matches one of them
        return targetAudioFileIds.includes(r.metadata.audioFileId) || 
               audioSourceIds.includes(r.metadata.audioSourceId);
      } else {
        // For all user audio, ensure audioSourceId is in user's files
        return audioSourceIds.includes(r.metadata.audioSourceId);
      }
    });

    console.log(`[Chat] Filtered to ${relevantChunks.length} relevant audio chunks`);

    // Build context from retrieved audio chunks
    const audioContext = relevantChunks
      .map((chunk, index) => {
        const text = chunk.metadata.text || "";
        const startTime = chunk.metadata.startTimeSec
          ? `[${this.formatTime(chunk.metadata.startTimeSec)}]`
          : "";
        return `[Audio Chunk ${index + 1}]${startTime} ${text}`;
      })
      .join("\n\n");

    // Build system prompt with user's name
    const systemPrompt = this.buildSystemPrompt(
      targetAudioFileIds.length > 0 ? targetAudioFileIds : undefined,
      userAudioFiles.length,
      userName
    );

    // Build messages array with conversation history
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Add conversation history (last 10 messages, excluding current message)
    for (const msg of conversationHistory) {
      if (msg.id !== userMessage.id && (msg.role === "user" || msg.role === "assistant")) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add current user message with audio context
    messages.push({
      role: "user",
      content: this.buildUserPrompt(message, audioContext),
    });

    console.log(`[Chat] Sending ${messages.length} messages to OpenAI (${conversationHistory.length} from history + current)`);

    // Create chat completion with streaming
    const stream = await this.openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages as any,
      stream: true,
      temperature: 0.7,
    });

    // Collect full response for storage
    let fullResponse = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    // Stream the response
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        yield content;
      }
    }

    // Count tokens accurately using tiktoken (OpenAI's official token counting library)
    // Note: OpenAI streaming responses don't include usage in chunks, so we count manually
    promptTokens = TokenCounterService.countPromptTokens(messages, "gpt-4o-mini");
    completionTokens = TokenCounterService.countCompletionTokens(fullResponse, "gpt-4o-mini");
    totalTokens = promptTokens + completionTokens;

    // Extract structured objects (tasks and questions) from response
    // We do this before saving the message so we can include the IDs
    let taskIds: string[] = [];
    let questionIds: string[] = [];
    let extractionTokens = 0; // Track tokens used for structured extraction
    let extractionPromptTokens = 0;
    let extractionCompletionTokens = 0;
    
    try {
      // Use first audioFileId for structured extraction (backwards compatible)
      const firstAudioFileId = targetAudioFileIds.length > 0 ? targetAudioFileIds[0] : undefined;
      const extracted = await this.extractAndStoreStructuredObjects(fullResponse, userId, firstAudioFileId);
      taskIds = extracted.taskIds;
      questionIds = extracted.questionIds;
      extractionTokens = extracted.tokens || 0;
      extractionPromptTokens = extracted.promptTokens || 0;
      extractionCompletionTokens = extracted.completionTokens || 0;
    } catch (error) {
      console.error("[Chat] Error extracting structured objects:", error);
      // Continue even if extraction fails - don't block the response
    }
    
    // Add extraction tokens to total (if any)
    // Use actual token counts from OpenAI response
    if (extractionTokens > 0) {
      totalTokens += extractionTokens;
      promptTokens += extractionPromptTokens;
      completionTokens += extractionCompletionTokens;
    }

    // Store assistant response with task and question IDs, and token usage
    // Use first audioFileId for backwards compatibility with existing schema
    await this.chatMessageRepository.create({
      userId,
      audioFileId: targetAudioFileIds.length > 0 ? targetAudioFileIds[0] : undefined,
      role: "assistant",
      content: fullResponse,
      taskIds: taskIds.length > 0 ? taskIds : undefined,
      questionIds: questionIds.length > 0 ? questionIds : undefined,
      promptTokens: promptTokens > 0 ? promptTokens : undefined,
      completionTokens: completionTokens > 0 ? completionTokens : undefined,
      totalTokens: totalTokens > 0 ? totalTokens : undefined,
    });
  }

  /**
   * Extract and store tasks and questions from the response
   * Returns the IDs of created tasks and questions
   */
  private async extractAndStoreStructuredObjects(
    responseText: string,
    userId: string,
    audioFileId?: string
  ): Promise<{ taskIds: string[]; questionIds: string[]; tokens?: number; promptTokens?: number; completionTokens?: number }> {
    const taskIds: string[] = [];
    const questionIds: string[] = [];
    let extractionTokens = 0;
    let extractionPromptTokens = 0;
    let extractionCompletionTokens = 0;

    try {
      const extracted = await this.extractionService.extractStructuredObjects(
        responseText,
        userId,
        audioFileId
      );

      extractionTokens = extracted.tokens || 0;
      extractionPromptTokens = extracted.promptTokens || 0;
      extractionCompletionTokens = extracted.completionTokens || 0;

      // Store tasks
      if (extracted.tasks.length > 0) {
        console.log(`[Chat] Extracted ${extracted.tasks.length} task(s)`);
        for (const task of extracted.tasks) {
          const createdTask = await this.taskRepository.create({
            userId: task.userId,
            audioFileId: task.audioFileId,
            description: task.description,
            dueDate: task.dueDate,
            priority: task.priority,
            location: task.location,
            status: task.status,
          });
          taskIds.push(createdTask.id);
        }
      }

      // Store questions
      if (extracted.questions.length > 0) {
        console.log(`[Chat] Extracted ${extracted.questions.length} question(s)`);
        for (const question of extracted.questions) {
          const createdQuestion = await this.questionRepository.create({
            userId: question.userId,
            audioFileId: question.audioFileId,
            type: question.type,
            question: question.question,
            options: question.options,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
          });
          questionIds.push(createdQuestion.id);
        }
      }
    } catch (error) {
      console.error("[Chat] Error in extractAndStoreStructuredObjects:", error);
      // Return what we have so far
    }

    return { 
      taskIds, 
      questionIds, 
      tokens: extractionTokens,
      promptTokens: extractionPromptTokens,
      completionTokens: extractionCompletionTokens
    };
  }

  /**
   * Get extracted objects for a response (for non-streaming use)
   */
  async getExtractedObjects(
    responseText: string,
    userId: string,
    audioFileId?: string
  ): Promise<{ tasks: Task[]; questions: Question[] }> {
    return await this.extractionService.extractStructuredObjects(
      responseText,
      userId,
      audioFileId
    );
  }

  private buildSystemPrompt(audioFileIds: string[] | undefined, totalAudioFiles: number, userName?: string): string {
    const audioFileId = audioFileIds && audioFileIds.length > 0 ? audioFileIds[0] : undefined;
    const isMultipleFiles = audioFileIds && audioFileIds.length > 1;
    
    // Personalize greeting with user's name if available
    const studentGreeting = userName ? `You are tutoring ${userName}.` : "You are tutoring a student.";
    
    const tutorInstructions = `${studentGreeting} You are a friendly, patient tutor who helps students understand content from their audio files. Your teaching style:

**Communication Style:**
- Keep messages SHORT and digestible (1-2 sentences max, like text messages with emojis and be personal)
- Explain ONE concept or point at a time - never dump everything at once
- Break complex topics into bite-sized pieces
- Use a casual, friendly tone (like texting a friend)
- Occasionally crack light jokes to keep things engaging, but stay focused on learning

**Teaching Approach:**
- Guide understanding step-by-step, not all at once
- Wait for the user to process one idea before moving to the next
- Ask if they understand before moving forward
- Focus on helping them truly grasp the content, not just reciting facts
- Reference conversation history and memory to build on previous discussions - remember what you've already explained and what the student has asked about

**Memory & Context:**
- You have access to the full conversation history - use it to remember what you've discussed, what the student understands, and where you left off
- Build on previous explanations rather than repeating yourself
- Reference earlier parts of the conversation naturally
- You have access to transcriptions from ${isMultipleFiles ? `${audioFileIds.length} audio files` : audioFileId ? "a specific audio file" : `${totalAudioFiles} audio file(s)`}. Use this context to answer questions, but if information isn't available, say so politely.

**Action Items & Questions:**
- When homework, tasks, or events are mentioned: generate ONE question AND action items if needed (not multiple questions)
- For questions: only generate true/false or multiple-choice questions (NO short answer questions)
- Keep it simple and relevant to what was just discussed
- Only suggest these when naturally relevant to the conversation

Remember: Short messages. One step at a time. Guide understanding. Be friendly. Use memory to build on previous conversations.`;

    return tutorInstructions;
  }

  private buildUserPrompt(message: string, context: string): string {
    return `Student question: ${message}

Relevant context from audio transcriptions:
${context || "No relevant context found."}

Respond as a tutor: Keep it short (1-2 sentences), explain ONE point at a time, and guide their understanding step-by-step. If they ask a complex question, break it down and start with the first part only.`;
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  /**
   * Find when a term was mentioned in the audio files
   * Returns mentions with timestamps, quotes, and count
   */
  async findMentions(params: {
    userId: string;
    term: string;
    audioFileId?: string;
    audioFileIds?: string[];
    topK?: number;
    all?: boolean;
  }): Promise<{
    term: string;
    count: number;
    mentions: Array<{
      timestamp: number;
      timestampFormatted: string;
      quote: string;
      audioFileId: string;
      startTimeSec: number;
      endTimeSec: number;
    }>;
  }> {
    const { userId, term, audioFileId, audioFileIds, topK = 50, all = false } = params;

    // Fetch and verify audio files
    let userAudioFiles: AudioFile[] = [];
    let targetAudioFileIds: string[] = [];

    if (all) {
      // When all=true, search across all user's audio files (ignore audioFileId/audioFileIds)
      userAudioFiles = await this.audioFileRepository.findByUserId(userId);
    } else {
      // Normalize audio file IDs when all=false
      if (audioFileIds && audioFileIds.length > 0) {
        targetAudioFileIds.push(...audioFileIds);
      } else if (audioFileId) {
        targetAudioFileIds.push(audioFileId);
      }

      if (targetAudioFileIds.length > 0) {
        const targetAudioFiles = await this.audioFileRepository.findByIds(targetAudioFileIds);
        if (targetAudioFiles.length !== targetAudioFileIds.length) {
          const foundIds = new Set(targetAudioFiles.map(f => f.id));
          const missingIds = targetAudioFileIds.filter(id => !foundIds.has(id));
          throw new Error(`Audio file(s) not found: ${missingIds.join(", ")}`);
        }
        for (const file of targetAudioFiles) {
          if (file.userId !== userId) {
            throw new Error(`Audio file ${file.id} is not authorized for this user`);
          }
        }
        userAudioFiles = targetAudioFiles;
      } else {
        userAudioFiles = await this.audioFileRepository.findByUserId(userId);
      }
    }

    const audioSourceIds = userAudioFiles
      .filter((f) => f.s3Bucket && f.s3Key)
      .map((f) => `${f.s3Bucket}/${f.s3Key}`);

    if (audioSourceIds.length === 0) {
      throw new Error("No audio files found for user");
    }

    // Build search filter
    const searchFilter: Record<string, any> = {
      userId: userId,
    };

    // Only filter by specific audio files if all=false and targetAudioFileIds are specified
    if (!all && targetAudioFileIds.length > 0) {
      if (targetAudioFileIds.length === 1) {
        searchFilter.audioFileId = targetAudioFileIds[0];
        if (audioSourceIds.length > 0) {
          searchFilter.audioSourceId = audioSourceIds[0];
        }
      } else {
        searchFilter.audioFileIds = targetAudioFileIds;
        if (audioSourceIds.length > 0) {
          searchFilter.audioSourceIds = audioSourceIds;
        }
      }
    }
    // When all=true, searchFilter only has userId, so it searches across all user's files

    // Embed the search term
    const [termEmbedding] = await this.embeddingProvider.embedTexts([
      { id: "term", text: term },
    ]);

    // Search for mentions
    const searchResults = await this.vectorStore.search(
      termEmbedding.embedding,
      topK,
      searchFilter
    );

    // Minimum similarity threshold for stricter matching
    // Cosine similarity ranges from -1 to 1, with typical relevant results around 0.1-0.3
    // Using 0.12 to filter out less relevant content while still getting good matches
    const MIN_SIMILARITY_THRESHOLD = 0.3;

    // Filter and process results with stricter similarity threshold
    const mentions = searchResults
      .filter((r) => {
        // Filter by similarity score (stricter matching)
        if (r.score < MIN_SIMILARITY_THRESHOLD) return false;
        
        // Security and ownership checks
        if (r.metadata.userId !== userId) return false;
        
        // When all=true, accept all user's audio files; otherwise filter by targetAudioFileIds
        if (all) {
          return audioSourceIds.includes(r.metadata.audioSourceId);
        } else if (targetAudioFileIds.length > 0) {
          return targetAudioFileIds.includes(r.metadata.audioFileId) ||
                 audioSourceIds.includes(r.metadata.audioSourceId);
        }
        return audioSourceIds.includes(r.metadata.audioSourceId);
      })
      .map((r) => {
        const startTimeSec = r.metadata.startTimeSec || 0;
        const endTimeSec = r.metadata.endTimeSec || startTimeSec;
        const quote = r.metadata.text || "";
        
        return {
          score: r.score, // Include score for sorting
          timestamp: startTimeSec,
          timestampFormatted: this.formatTime(startTimeSec),
          quote: quote.trim(),
          audioFileId: r.metadata.audioFileId || "",
          startTimeSec,
          endTimeSec,
        };
      })
      .filter((m) => m.quote.length > 0) // Only include results with text
      .sort((a, b) => b.score - a.score); // Sort by relevance score (most relevant first)

    // Remove duplicates (same timestamp and similar quote)
    const uniqueMentions = mentions.filter((mention, index, self) => {
      return index === self.findIndex((m) => 
        Math.abs(m.timestamp - mention.timestamp) < 1 && 
        m.quote === mention.quote
      );
    })
    // Remove score from final output (not part of response format)
    .map(({ score, ...mention }) => mention);

    return {
      term,
      count: uniqueMentions.length,
      mentions: uniqueMentions,
    };
  }
}

