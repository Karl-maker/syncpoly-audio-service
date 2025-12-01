import { Breakdown } from "../../domain/entities/breakdown";
import { BreakdownRepository } from "../../infrastructure/database/repositories/breakdown.repository";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { TaskRepository } from "../../infrastructure/database/repositories/task.repository";
import { QuestionRepository } from "../../infrastructure/database/repositories/question.repository";

export interface CreateBreakdownUseCaseParams {
  audioFileId: string;
  userId: string;
  introduction: string;
  bulletPoints: string[];
  mainTakeaways: string[];
  actionItemIds?: string[];
  questionIds?: string[];
}

export class CreateBreakdownUseCase {
  constructor(
    private audioFileRepository: AudioFileRepository,
    private breakdownRepository: BreakdownRepository,
    private taskRepository: TaskRepository,
    private questionRepository: QuestionRepository
  ) {}

  async execute(params: CreateBreakdownUseCaseParams): Promise<Breakdown> {
    const { audioFileId, userId, introduction, bulletPoints, mainTakeaways, actionItemIds, questionIds } = params;

    // Verify audio file exists and belongs to user
    const audioFile = await this.audioFileRepository.findById(audioFileId);
    if (!audioFile) {
      throw new Error(`Audio file with ID ${audioFileId} not found`);
    }
    if (audioFile.userId !== userId) {
      throw new Error("Unauthorized: Audio file does not belong to user");
    }

    // Check if breakdown already exists
    const existing = await this.breakdownRepository.findByAudioFileId(audioFileId);
    if (existing) {
      throw new Error(`Breakdown already exists for audio file ${audioFileId}. Use update instead.`);
    }

    // Fetch tasks and questions if IDs provided
    const actionItems = [];
    if (actionItemIds && actionItemIds.length > 0) {
      for (const taskId of actionItemIds) {
        const task = await this.taskRepository.findById(taskId);
        if (!task) {
          throw new Error(`Task with ID ${taskId} not found`);
        }
        if (task.userId !== userId) {
          throw new Error(`Unauthorized: Task ${taskId} does not belong to user`);
        }
        actionItems.push(task);
      }
    }

    const questions = [];
    if (questionIds && questionIds.length > 0) {
      for (const questionId of questionIds) {
        const question = await this.questionRepository.findById(questionId);
        if (!question) {
          throw new Error(`Question with ID ${questionId} not found`);
        }
        if (question.userId !== userId) {
          throw new Error(`Unauthorized: Question ${questionId} does not belong to user`);
        }
        questions.push(question);
      }
    }

    // Create breakdown
    const breakdown = await this.breakdownRepository.create({
      userId,
      audioFileId,
      introduction,
      bulletPoints,
      mainTakeaways,
      actionItems,
      questions,
    });

    return breakdown;
  }
}

