import { QuestionRepository } from "../../infrastructure/database/repositories/question.repository";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { Question } from "../../domain/entities/question";

export interface GetQuestionsByAudioFileUseCaseParams {
  audioFileId: string;
  userId: string;
  page?: number; // Optional: page number for pagination (default: 1)
  limit?: number; // Optional: items per page (default: 10)
}

export interface GetQuestionsByAudioFileUseCaseResult {
  questions: Question[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class GetQuestionsByAudioFileUseCase {
  constructor(
    private questionRepository: QuestionRepository,
    private audioFileRepository: AudioFileRepository
  ) {}

  async execute(params: GetQuestionsByAudioFileUseCaseParams): Promise<GetQuestionsByAudioFileUseCaseResult> {
    const { audioFileId, userId, page, limit } = params;

    // Verify audio file exists and belongs to user
    const audioFile = await this.audioFileRepository.findById(audioFileId);
    if (!audioFile) {
      throw new Error(`Audio file not found: ${audioFileId}`);
    }

    if (audioFile.userId !== userId) {
      throw new Error("Unauthorized: Audio file does not belong to user");
    }

    // Get questions for this audio file with pagination if requested
    if (page !== undefined && limit !== undefined) {
      const result = await this.questionRepository.findByAudioFileIdPaginated(audioFileId, page, limit);
      return {
        questions: result.questions,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      };
    } else {
      // Backward compatibility: return all questions if pagination not requested
      const questions = await this.questionRepository.findByAudioFileId(audioFileId);
      return { questions };
    }
  }
}

