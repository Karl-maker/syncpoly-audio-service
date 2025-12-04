import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { Transcript } from "../../domain/entities/transcript";

export interface GetTranscriptUseCaseParams {
  audioFileId: string;
  userId: string;
  orderIndex?: number; // Optional: get specific transcript by orderIndex
  page?: number; // Optional: page number for pagination (default: 1)
  limit?: number; // Optional: items per page (default: 10)
}

export interface GetTranscriptUseCaseResult {
  transcripts: Transcript[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  completed: boolean; // Whether all parts have been transcribed
}

export class GetTranscriptUseCase {
  constructor(
    private transcriptRepository: TranscriptRepository,
    private audioFileRepository: AudioFileRepository
  ) {}

  /**
   * Get transcript(s) for an audio file
   * Always returns the same structure with transcripts array, completed flag, and optional pagination
   * If orderIndex is provided, returns only that specific transcript in the array
   * Otherwise, returns all or paginated transcripts (sorted by orderIndex)
   */
  async execute(params: GetTranscriptUseCaseParams): Promise<GetTranscriptUseCaseResult | null> {
    const { audioFileId, userId, orderIndex, page, limit } = params;

    // Verify audio file exists and belongs to user
    const audioFile = await this.audioFileRepository.findById(audioFileId);
    if (!audioFile) {
      throw new Error(`Audio file not found: ${audioFileId}`);
    }

    if (audioFile.userId !== userId) {
      throw new Error("Unauthorized: Audio file does not belong to user");
    }

    // Get all transcripts for the audio file to calculate completed status
    let allTranscripts = await this.transcriptRepository.findByAudioFileId(audioFileId);
    
    // Backward compatibility: if no transcripts found by audioFileId, try audioSourceId
    if (allTranscripts.length === 0) {
      if (audioFile.s3Bucket && audioFile.s3Key) {
        const audioSourceId = `${audioFile.s3Bucket}/${audioFile.s3Key}`;
        allTranscripts = await this.transcriptRepository.findByAudioSourceId(audioSourceId);
      }
    }

    // Determine if transcription is completed
    // Completed means we have transcripts for all parts (if parts exist)
    const partCount = audioFile.partCount || (audioFile.parts ? audioFile.parts.length : 0);
    const transcriptCount = allTranscripts.length;
    const completed = partCount === 0 ? transcriptCount > 0 : transcriptCount >= partCount;

    // If orderIndex is specified, filter to that specific transcript
    let transcripts: Transcript[] = [];
    if (orderIndex !== undefined) {
      const transcript = allTranscripts.find((t) => (t.orderIndex || 0) === orderIndex);
      if (!transcript) {
        throw new Error(`Transcript with orderIndex ${orderIndex} not found`);
      }
      transcripts = [transcript];
    } else {
      transcripts = allTranscripts;
    }

    if (transcripts.length === 0) {
      return null;
    }

    // Apply pagination if requested (but not when orderIndex is specified)
    let total = transcripts.length;
    let totalPages = 1;
    let paginatedTranscripts = transcripts;

    if (orderIndex === undefined && page !== undefined && limit !== undefined) {
      // Apply pagination to the filtered transcripts
      const skip = (page - 1) * limit;
      paginatedTranscripts = transcripts.slice(skip, skip + limit);
      total = transcripts.length;
      totalPages = Math.ceil(total / limit);
    }

    // Return result with consistent structure
    const result: GetTranscriptUseCaseResult = {
      transcripts: paginatedTranscripts,
      completed,
    };

    // Add pagination info if pagination was requested
    if (orderIndex === undefined && page !== undefined && limit !== undefined) {
      result.pagination = {
        page,
        limit,
        total,
        totalPages,
      };
    }

    return result;
  }
}

