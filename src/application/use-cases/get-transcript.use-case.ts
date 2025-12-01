import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { Transcript } from "../../domain/entities/transcript";

export interface GetTranscriptUseCaseParams {
  audioFileId: string;
  userId: string;
  orderIndex?: number; // Optional: get specific transcript by orderIndex
}

export class GetTranscriptUseCase {
  constructor(
    private transcriptRepository: TranscriptRepository,
    private audioFileRepository: AudioFileRepository
  ) {}

  /**
   * Get transcript(s) for an audio file
   * If orderIndex is provided, returns that specific transcript
   * Otherwise, returns all transcripts for the audio file (sorted by orderIndex)
   */
  async execute(params: GetTranscriptUseCaseParams): Promise<Transcript | Transcript[] | null> {
    const { audioFileId, userId, orderIndex } = params;

    // Verify audio file exists and belongs to user
    const audioFile = await this.audioFileRepository.findById(audioFileId);
    if (!audioFile) {
      throw new Error(`Audio file not found: ${audioFileId}`);
    }

    if (audioFile.userId !== userId) {
      throw new Error("Unauthorized: Audio file does not belong to user");
    }

    // Try to find transcripts by audioFileId first (newer transcripts)
    let transcripts = await this.transcriptRepository.findByAudioFileId(audioFileId);

    // Backward compatibility: if no transcripts found by audioFileId, try audioSourceId
    if (transcripts.length === 0) {
      if (!audioFile.s3Bucket || !audioFile.s3Key) {
        throw new Error("Audio file does not have S3 location");
      }
      const audioSourceId = `${audioFile.s3Bucket}/${audioFile.s3Key}`;
      transcripts = await this.transcriptRepository.findByAudioSourceId(audioSourceId);
    }

    if (transcripts.length === 0) {
      return null;
    }

    // If orderIndex is specified, return that specific transcript
    if (orderIndex !== undefined) {
      const transcript = transcripts.find((t) => (t.orderIndex || 0) === orderIndex);
      if (!transcript) {
        throw new Error(`Transcript with orderIndex ${orderIndex} not found`);
      }
      return transcript;
    }

    // Return all transcripts (sorted by orderIndex)
    return transcripts;
  }
}

