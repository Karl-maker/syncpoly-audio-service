import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { Transcript } from "../../domain/entities/transcript";

export interface GetTranscriptUseCaseParams {
  audioFileId: string;
  userId: string;
}

export class GetTranscriptUseCase {
  constructor(
    private transcriptRepository: TranscriptRepository,
    private audioFileRepository: AudioFileRepository
  ) {}

  async execute(params: GetTranscriptUseCaseParams): Promise<Transcript | null> {
    const { audioFileId, userId } = params;

    // Verify audio file exists and belongs to user
    const audioFile = await this.audioFileRepository.findById(audioFileId);
    if (!audioFile) {
      throw new Error(`Audio file not found: ${audioFileId}`);
    }

    if (audioFile.userId !== userId) {
      throw new Error("Unauthorized: Audio file does not belong to user");
    }

    // Build audioSourceId from S3 bucket and key
    if (!audioFile.s3Bucket || !audioFile.s3Key) {
      throw new Error("Audio file does not have S3 location");
    }

    const audioSourceId = `${audioFile.s3Bucket}/${audioFile.s3Key}`;

    // Find transcript by audioSourceId
    const transcripts = await this.transcriptRepository.findByAudioSourceId(audioSourceId);

    // Return the most recent transcript if multiple exist
    return transcripts.length > 0 ? transcripts[0] : null;
  }
}

