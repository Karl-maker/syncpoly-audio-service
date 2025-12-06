import { TaskRepository } from "../../infrastructure/database/repositories/task.repository";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { Task } from "../../domain/entities/task";

export interface GetTasksByAudioFileUseCaseParams {
  audioFileId: string;
  userId: string;
  page?: number; // Optional: page number for pagination (default: 1)
  limit?: number; // Optional: items per page (default: 10)
}

export interface GetTasksByAudioFileUseCaseResult {
  tasks: Task[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class GetTasksByAudioFileUseCase {
  constructor(
    private taskRepository: TaskRepository,
    private audioFileRepository: AudioFileRepository
  ) {}

  async execute(params: GetTasksByAudioFileUseCaseParams): Promise<GetTasksByAudioFileUseCaseResult> {
    const { audioFileId, userId, page, limit } = params;

    // Verify audio file exists and belongs to user
    const audioFile = await this.audioFileRepository.findById(audioFileId);
    if (!audioFile) {
      throw new Error(`Audio file not found: ${audioFileId}`);
    }

    if (audioFile.userId !== userId) {
      throw new Error("Unauthorized: Audio file does not belong to user");
    }

    // Get tasks for this audio file with pagination if requested
    if (page !== undefined && limit !== undefined) {
      const result = await this.taskRepository.findByAudioFileIdPaginated(audioFileId, page, limit);
      return {
        tasks: result.tasks,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      };
    } else {
      // Backward compatibility: return all tasks if pagination not requested
      const tasks = await this.taskRepository.findByAudioFileId(audioFileId);
      return { tasks };
    }
  }
}

