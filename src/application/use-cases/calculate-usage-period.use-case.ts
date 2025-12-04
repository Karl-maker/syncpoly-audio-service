import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";
import { MemoryUsage, ProcessLogEntry } from "../../domain/entities/memory-usage";

// OpenAI Whisper API pricing: $0.006 per minute
const OPENAI_CREDITS_PER_MINUTE = 0.006;
const OPENAI_CREDITS_PER_SECOND = OPENAI_CREDITS_PER_MINUTE / 60;

export interface CalculateUsagePeriodUseCaseParams {
  userId: string;
  startDate: Date;
  endDate: Date;
}

export interface UsagePeriodResult {
  userId: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  totalStorageBytes: number;
  totalAudioProcessedSeconds: number;
  totalAudioProcessedMinutes: number;
  totalAICreditsUsed: number;
  provider: string;
  processLog: ProcessLogEntry[];
  calculatedAt: Date;
}

export class CalculateUsagePeriodUseCase {
  constructor(
    private audioFileRepository: AudioFileRepository,
    private processingJobRepository: ProcessingJobRepository,
    private transcriptRepository: TranscriptRepository
  ) {}

  async execute(params: CalculateUsagePeriodUseCaseParams): Promise<UsagePeriodResult> {
    const { userId, startDate, endDate } = params;

    // Get all processing jobs in the date range
    const allJobs = await this.processingJobRepository.findByUserId(userId);
    const jobsInPeriod = allJobs.filter((job) => {
      const jobDate = job.completedAt || job.startedAt || job.createdAt;
      return jobDate >= startDate && jobDate <= endDate;
    });

    // Get all audio files for the user
    const audioFiles = await this.audioFileRepository.findByUserId(userId);
    const audioFileMap = new Map(audioFiles.map((file) => [file.id, file]));

    // Calculate storage for files uploaded in the period
    const filesInPeriod = audioFiles.filter(
      (file) => file.uploadedAt >= startDate && file.uploadedAt <= endDate
    );
    const totalStorageBytes = filesInPeriod.reduce((sum, file) => sum + file.fileSize, 0);

    // Calculate audio processed and credits used
    let totalAudioProcessedSeconds = 0;
    let totalAICreditsUsed = 0;
    const processLog: ProcessLogEntry[] = [];

    for (const job of jobsInPeriod) {
      if (job.status !== "completed") {
        continue; // Only count completed jobs
      }

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

    return {
      userId,
      period: {
        startDate,
        endDate,
      },
      totalStorageBytes,
      totalAudioProcessedSeconds,
      totalAudioProcessedMinutes: totalAudioProcessedSeconds / 60,
      totalAICreditsUsed,
      provider: "openai", // Default provider
      processLog,
      calculatedAt: new Date(),
    };
  }
}

