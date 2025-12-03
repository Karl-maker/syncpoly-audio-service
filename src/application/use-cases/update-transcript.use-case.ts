import { Transcript, TranscriptSegment, Speaker } from "../../domain/entities/transcript";
import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";

export interface UpdateTranscriptUseCaseParams {
  transcriptId: string;
  userId: string;
  speakers?: Speaker[];
  segments?: TranscriptSegment[];
}

export class UpdateTranscriptUseCase {
  constructor(
    private transcriptRepository: TranscriptRepository,
    private audioFileRepository: AudioFileRepository
  ) {}

  async execute(params: UpdateTranscriptUseCaseParams): Promise<Transcript> {
    const { transcriptId, userId, speakers, segments } = params;

    // Get existing transcript
    const transcript = await this.transcriptRepository.findById(transcriptId);
    if (!transcript) {
      throw new Error(`Transcript with ID ${transcriptId} not found`);
    }

    // Verify transcript belongs to user via audioFileId
    if (transcript.audioFileId) {
      const audioFile = await this.audioFileRepository.findById(transcript.audioFileId);
      if (!audioFile) {
        throw new Error(`Audio file ${transcript.audioFileId} not found`);
      }
      if (audioFile.userId !== userId) {
        throw new Error("Unauthorized: Transcript does not belong to user");
      }
    } else {
      // For backward compatibility, if no audioFileId, we can't verify ownership
      // In this case, we'll allow the update but log a warning
      console.warn(`[UpdateTranscript] Transcript ${transcriptId} has no audioFileId, cannot verify ownership`);
    }

    // Build update object
    const updates: Partial<Transcript> = {};

    if (speakers !== undefined) {
      updates.speakers = speakers;
    }

    if (segments !== undefined) {
      updates.segments = segments;
    }

    // Update transcript
    const updated = await this.transcriptRepository.update(transcriptId, updates);

    if (!updated) {
      throw new Error(`Failed to update transcript with ID ${transcriptId}`);
    }

    return updated;
  }
}

