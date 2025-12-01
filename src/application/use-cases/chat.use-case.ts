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
    const { userId, message, audioFileId, topK = 5 } = params;

    // Verify audio file belongs to user if specified
    if (audioFileId) {
      const audioFile = await this.audioFileRepository.findById(audioFileId);
      if (!audioFile || audioFile.userId !== userId) {
        throw new Error("Audio file not found or unauthorized");
      }
    }

    // Get user's audio files to build filter
    const userAudioFiles = await this.audioFileRepository.findByUserId(userId);
    const audioSourceIds = audioFileId
      ? [userAudioFiles.find((f) => f.id === audioFileId)?.s3Uri].filter(Boolean)
      : userAudioFiles.map((f) => f.s3Uri).filter(Boolean);

    if (audioSourceIds.length === 0) {
      throw new Error("No audio files found for user");
    }

    // Embed the user's query
    const [queryEmbedding] = await this.embeddingProvider.embedTexts([
      { id: "query", text: message },
    ]);

    // Search vector store for relevant context
    const searchFilter: Record<string, any> = {};
    if (audioFileId && audioSourceIds.length > 0) {
      // Filter by specific audio file
      searchFilter.audioSourceId = audioSourceIds[0];
    } else {
      // Filter by all user's audio files
      // Note: Vector store filter might need to support array matching
      // For now, we'll search without filter and filter results
    }

    const searchResults = await this.vectorStore.search(
      queryEmbedding.embedding,
      topK,
      searchFilter.audioSourceId ? searchFilter : undefined
    );

    // Filter results by audioSourceId if not already filtered
    const relevantChunks = audioFileId
      ? searchResults.filter((r) => r.metadata.audioSourceId === audioSourceIds[0])
      : searchResults.filter((r) => audioSourceIds.includes(r.metadata.audioSourceId));

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

