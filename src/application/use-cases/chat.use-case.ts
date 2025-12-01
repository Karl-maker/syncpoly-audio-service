import OpenAI from "openai";
import { IEmbeddingProvider } from "../../domain/interfaces/iembedding.provider";
import { IVectorStore } from "../../domain/interfaces/ivector.store";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";

export interface ChatUseCaseParams {
  userId: string;
  message: string;
  audioFileId?: string;
  topK?: number;
}

export class ChatUseCase {
  private openaiClient: OpenAI;

  constructor(
    private embeddingProvider: IEmbeddingProvider,
    private vectorStore: IVectorStore,
    private audioFileRepository: AudioFileRepository,
    openaiApiKey: string
  ) {
    this.openaiClient = new OpenAI({ apiKey: openaiApiKey });
  }

  async *execute(params: ChatUseCaseParams): AsyncGenerator<string, void, unknown> {
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

    // Embed the user's query
    const [queryEmbedding] = await this.embeddingProvider.embedTexts([
      { id: "query", text: message },
    ]);

    // Build search filter with userId (required) and optional audioFileId
    const searchFilter: Record<string, any> = {
      userId: userId, // Always filter by userId for security
    };
    
    if (audioFileId && audioSourceIds.length > 0) {
      // Filter by specific audio file
      searchFilter.audioFileId = audioFileId;
      searchFilter.audioSourceId = audioSourceIds[0];
    }

    console.log(`[Chat] Searching vector store for query: "${message}" with filter:`, searchFilter);

    const searchResults = await this.vectorStore.search(
      queryEmbedding.embedding,
      topK,
      searchFilter
    );

    console.log(`[Chat] Found ${searchResults.length} search results`);

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

    console.log(`[Chat] Filtered to ${relevantChunks.length} relevant chunks`);

    // Build context from retrieved chunks
    const context = relevantChunks
      .map((chunk, index) => {
        const text = chunk.metadata.text || "";
        const startTime = chunk.metadata.startTimeSec
          ? `[${this.formatTime(chunk.metadata.startTimeSec)}]`
          : "";
        return `[Chunk ${index + 1}]${startTime} ${text}`;
      })
      .join("\n\n");

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(audioFileId, userAudioFiles.length);

    // Create chat completion with streaming
    const stream = await this.openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: this.buildUserPrompt(message, context),
        },
      ],
      stream: true,
      temperature: 0.7,
    });

    // Stream the response
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  private buildSystemPrompt(audioFileId: string | undefined, totalAudioFiles: number): string {
    if (audioFileId) {
      return `You are an AI assistant helping a user discuss details about a specific audio file they have uploaded and processed. 
You have access to transcriptions and embeddings from their audio content. Use the provided context from the audio transcription 
chunks to answer questions accurately. If the context doesn't contain relevant information, say so.

Focus on:
- Discussing the content, topics, and details mentioned in the audio
- Answering questions about what was said, who spoke, and when
- Providing insights based on the transcriptions
- Being helpful and conversational

If asked about information not in the provided context, politely indicate that you don't have that information in the current audio file.`;
    } else {
      return `You are an AI assistant helping a user discuss details about their audio files. The user has ${totalAudioFiles} audio file(s) 
that have been processed. You have access to transcriptions and embeddings from their audio content. Use the provided context from 
the audio transcription chunks to answer questions accurately. If the context doesn't contain relevant information, say so.

Focus on:
- Discussing the content, topics, and details mentioned across their audio files
- Answering questions about what was said, who spoke, and when
- Providing insights based on the transcriptions
- Comparing or summarizing content across multiple audio files if relevant
- Being helpful and conversational

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

