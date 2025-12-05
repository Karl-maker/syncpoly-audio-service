import OpenAI from "openai";
import { IEmbeddingProvider } from "../../domain/interfaces/iembedding.provider";
import { IVectorStore } from "../../domain/interfaces/ivector.store";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { ChatMessageRepository } from "../../infrastructure/database/repositories/chat-message.repository";
import { TaskRepository } from "../../infrastructure/database/repositories/task.repository";
import { QuestionRepository } from "../../infrastructure/database/repositories/question.repository";
import { StructuredExtractionService } from "../services/structured-extraction.service";
import { TokenCounterService } from "../../infrastructure/openai/token-counter.service";
import { Task } from "../../domain/entities/task";
import { Question } from "../../domain/entities/question";

export interface ChatUseCaseParams {
  userId: string;
  message: string;
  audioFileId?: string;
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
    openaiApiKey: string
  ) {
    this.openaiClient = new OpenAI({ apiKey: openaiApiKey });
    this.extractionService = new StructuredExtractionService(openaiApiKey);
  }

  async *execute(params: ChatUseCaseParams): AsyncGenerator<string | ChatUseCaseResult, void, unknown> {
    // Default topK to 10 for better results, especially when filtering
    const { userId, message, audioFileId, topK = 10 } = params;

    // Verify audio file belongs to user if specified
    if (audioFileId) {
      const audioFile = await this.audioFileRepository.findById(audioFileId);
      if (!audioFile || audioFile.userId !== userId) {
        throw new Error("Audio file not found or unauthorized");
      }
    }

    // Get user's audio files to build filter
    const userAudioFiles = await this.audioFileRepository.findByUserId(userId);
    
    // Build audioSourceId format: "bucket/key" (matches what IAudioSource.getId() returns)
    const audioSourceIds = audioFileId
      ? (() => {
          const file = userAudioFiles.find((f) => f.id === audioFileId);
          return file && file.s3Bucket && file.s3Key ? [`${file.s3Bucket}/${file.s3Key}`] : [];
        })()
      : userAudioFiles
          .filter((f) => f.s3Bucket && f.s3Key)
          .map((f) => `${f.s3Bucket}/${f.s3Key}`);

    if (audioSourceIds.length === 0) {
      throw new Error("No audio files found for user");
    }

    // Store user message
    const userMessage = await this.chatMessageRepository.create({
      userId,
      audioFileId: audioFileId,
      role: "user",
      content: message,
    });

    // Get last 10 messages for conversation context (excluding current message)
    const conversationHistory = await this.chatMessageRepository.getConversationHistory(
      userId,
      audioFileId,
      10
    );

    // Embed the user's query for audio search
    const [queryEmbedding] = await this.embeddingProvider.embedTexts([
      { id: "query", text: message },
    ]);

    // Build search filter with userId (required) and optional audioFileId
    // Only search audio embeddings (not conversation messages)
    const searchFilter: Record<string, any> = {
      userId: userId, // Always filter by userId for security
    };
    
    if (audioFileId && audioSourceIds.length > 0) {
      // Filter by specific audio file
      searchFilter.audioFileId = audioFileId;
      searchFilter.audioSourceId = audioSourceIds[0];
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
      
      if (audioFileId) {
        // For specific audio file, ensure it matches
        return r.metadata.audioFileId === audioFileId || 
               r.metadata.audioSourceId === audioSourceIds[0];
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

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(audioFileId, userAudioFiles.length);

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
      const extracted = await this.extractAndStoreStructuredObjects(fullResponse, userId, audioFileId);
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
    await this.chatMessageRepository.create({
      userId,
      audioFileId: audioFileId,
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

  private buildSystemPrompt(audioFileId: string | undefined, totalAudioFiles: number): string {
    const memoryNote = "You have access to the conversation history, so you can reference past discussions and maintain context across the conversation.";
    const taskNote = "When appropriate, you can suggest action items, tasks, or homework based on the conversation. If the user asks for questions to test their understanding, you can generate questions (true/false, multiple choice, or short answer).";

    if (audioFileId) {
      return `You are an AI assistant helping a user discuss details about a specific audio file they have uploaded and processed. 
You have access to transcriptions and embeddings from their audio content. Use the provided context from the audio transcription 
chunks to answer questions accurately. If the context doesn't contain relevant information, say so. ${memoryNote}

Focus on:
- Discussing the content, topics, and details mentioned in the audio
- Answering questions about what was said, who spoke, and when
- Providing insights based on the transcriptions
- Being helpful and conversational
- Remembering and referencing previous parts of the conversation
- ${taskNote}

If asked about information not in the provided context, politely indicate that you don't have that information in the current audio file.`;
    } else {
      return `You are an AI assistant helping a user discuss details about their audio files. The user has ${totalAudioFiles} audio file(s) 
that have been processed. You have access to transcriptions and embeddings from their audio content. Use the provided context from 
the audio transcription chunks to answer questions accurately. If the context doesn't contain relevant information, say so. ${memoryNote}

Focus on:
- Discussing the content, topics, and details mentioned across their audio files
- Answering questions about what was said, who spoke, and when
- Providing insights based on the transcriptions
- Comparing or summarizing content across multiple audio files if relevant
- Being helpful and conversational
- Remembering and referencing previous parts of the conversation
- ${taskNote}

If asked about information not in the provided context, politely indicate that you don't have that information in their audio files.`;
    }
  }

  private buildUserPrompt(message: string, context: string): string {
    return `User question: ${message}

Relevant context from audio transcriptions:
${context || "No relevant context found."}

Please answer the user's question based on the context provided above.`;
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
}

