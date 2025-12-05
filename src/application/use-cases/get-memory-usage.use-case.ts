import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";
import { ChatMessageRepository } from "../../infrastructure/database/repositories/chat-message.repository";
import { IVectorStore } from "../../domain/interfaces/ivector.store";
import { MemoryUsage, ProcessLogEntry } from "../../domain/entities/memory-usage";

// OpenAI Whisper API pricing: $0.006 per minute
const OPENAI_CREDITS_PER_MINUTE = 0.006;
const OPENAI_CREDITS_PER_SECOND = OPENAI_CREDITS_PER_MINUTE / 60;

// OpenAI Chat API pricing for gpt-4o-mini (per 1M tokens)
const OPENAI_CHAT_INPUT_PRICE_PER_1M = 0.15; // $0.15 per 1M input tokens
const OPENAI_CHAT_OUTPUT_PRICE_PER_1M = 0.60; // $0.60 per 1M output tokens

export interface GetMemoryUsageUseCaseParams {
  userId: string;
  vectorStore?: IVectorStore;
}

export class GetMemoryUsageUseCase {
  constructor(
    private audioFileRepository: AudioFileRepository,
    private processingJobRepository: ProcessingJobRepository,
    private transcriptRepository: TranscriptRepository,
    private chatMessageRepository: ChatMessageRepository
  ) {}

  async execute(params: GetMemoryUsageUseCaseParams): Promise<MemoryUsage> {
    const { userId } = params;

    // Get total storage from audio files
    const totalStorageBytes = await this.audioFileRepository.getTotalStorageByUserId(
      userId
    );

    // Get audio files count
    const audioFiles = await this.audioFileRepository.findByUserId(userId);
    const totalAudioFiles = audioFiles.length;

    // Get processing jobs to estimate vector store records
    // Note: This is an approximation. In a real implementation, you'd query the vector store directly
    const processingJobs = await this.processingJobRepository.findByUserId(userId);
    const completedJobs = processingJobs.filter((job) => job.status === "completed");
    const totalVectorStoreRecords = completedJobs.length;

    // Estimate vector store memory (rough estimate: ~1KB per record)
    const vectorStoreMemoryBytes = totalVectorStoreRecords * 1024;

    // Calculate total audio processed and credits used
    let totalAudioProcessedSeconds = 0;
    let totalAICreditsUsed = 0;
    const processLog: ProcessLogEntry[] = [];
    const audioFileMap = new Map(audioFiles.map((file) => [file.id, file]));

    for (const job of completedJobs) {
      const audioFile = audioFileMap.get(job.audioFileId);
      if (!audioFile) {
        continue;
      }

      // Calculate total audio duration
      // Priority: 1) Use audioFile.duration (most accurate - stores total duration for chunked files), 
      //           2) Use max transcript duration (for single files), 3) Estimate from file size
      let audioProcessedSeconds = 0;
      
      if (audioFile.duration && audioFile.duration > 0) {
        // Use the actual duration from the audio file (most accurate)
        // This is the total duration including all chunks
        audioProcessedSeconds = audioFile.duration;
      } else {
        // Fallback: Calculate from transcripts
        const transcripts = await this.transcriptRepository.findByAudioFileId(job.audioFileId);
        
        if (transcripts.length > 0) {
          // Find the maximum endTimeSec from all transcripts
          // Note: For chunked files, each transcript's endTimeSec is relative to that chunk,
          // so we can't simply sum them. Using max is an approximation.
          // The audioFile.duration field should be used for accurate results.
          for (const transcript of transcripts) {
            if (transcript.segments && transcript.segments.length > 0) {
              const lastSegment = transcript.segments[transcript.segments.length - 1];
              const transcriptDuration = lastSegment.endTimeSec;
              audioProcessedSeconds = Math.max(audioProcessedSeconds, transcriptDuration);
            }
          }
        }
        
        // If still no duration, estimate from file size (rough estimate: 1MB ≈ 1 minute at 128kbps)
        if (audioProcessedSeconds === 0 && audioFile.fileSize > 0) {
          // Estimate: assume 128kbps bitrate
          const bitrateBps = 128 * 1000;
          audioProcessedSeconds = (audioFile.fileSize * 8) / bitrateBps;
        }
      }

      // Calculate credits used (OpenAI pricing)
      const creditsUsed = audioProcessedSeconds * OPENAI_CREDITS_PER_SECOND;

      totalAudioProcessedSeconds += audioProcessedSeconds;
      totalAICreditsUsed += creditsUsed;

      // Add to process log (only for completed or failed jobs)
      if (job.status === "completed" || job.status === "failed") {
        const jobDate = job.completedAt || job.startedAt || job.createdAt;
        processLog.push({
          date: jobDate,
          audioFileId: job.audioFileId,
          audioFilename: audioFile.filename,
          audioProcessedSeconds,
          aiCreditsUsed: creditsUsed,
          provider: job.vectorStoreType || "openai",
          status: job.status,
          processingJobId: job.id,
        });
      }
    }

    // Sort process log by date (most recent first)
    processLog.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Calculate chat token usage
    const chatTokenUsage = await this.chatMessageRepository.getTotalTokenUsageByUserId(userId);
    
    // Calculate chat credits used (gpt-4o-mini pricing)
    // Input: $0.15 per 1M tokens, Output: $0.60 per 1M tokens
    const chatInputCredits = (chatTokenUsage.promptTokens / 1_000_000) * OPENAI_CHAT_INPUT_PRICE_PER_1M;
    const chatOutputCredits = (chatTokenUsage.completionTokens / 1_000_000) * OPENAI_CHAT_OUTPUT_PRICE_PER_1M;
    const totalChatCreditsUsed = chatInputCredits + chatOutputCredits;

    return {
      userId,
      totalAudioFiles,
      totalStorageBytes,
      totalVectorStoreRecords,
      vectorStoreMemoryBytes,
      totalAudioProcessedSeconds,
      totalAICreditsUsed,
      totalChatTokens: chatTokenUsage.totalTokens,
      totalChatCreditsUsed,
      provider: "openai", // Default provider
      processLog,
      lastCalculatedAt: new Date(),
    };
  }
}




