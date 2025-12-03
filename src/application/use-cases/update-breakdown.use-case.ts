import { Breakdown } from "../../domain/entities/breakdown";
import { BreakdownRepository } from "../../infrastructure/database/repositories/breakdown.repository";
import { TaskRepository } from "../../infrastructure/database/repositories/task.repository";
import { QuestionRepository } from "../../infrastructure/database/repositories/question.repository";

export interface UpdateBreakdownUseCaseParams {
  breakdownId: string;
  userId: string;
  introduction?: string;
  bulletPoints?: string[];
  mainTakeaways?: string[];
  actionItemIds?: string[];
  questionIds?: string[];
}

export class UpdateBreakdownUseCase {
  constructor(
    private breakdownRepository: BreakdownRepository,
    private taskRepository: TaskRepository,
    private questionRepository: QuestionRepository
  ) {}

  async execute(params: UpdateBreakdownUseCaseParams): Promise<Breakdown> {
    const { breakdownId, userId, introduction, bulletPoints, mainTakeaways, actionItemIds, questionIds } = params;

    // Get existing breakdown
    const breakdown = await this.breakdownRepository.findById(breakdownId);
    if (!breakdown) {
      throw new Error(`Breakdown with ID ${breakdownId} not found`);
    }
    if (breakdown.userId !== userId) {
      throw new Error("Unauthorized: Breakdown does not belong to user");
    }

    // Build update object
    const updates: Partial<Breakdown> = {};

    if (introduction !== undefined) {
      updates.introduction = introduction;
    }
    if (bulletPoints !== undefined) {
      updates.bulletPoints = bulletPoints;
    }
    if (mainTakeaways !== undefined) {
      updates.mainTakeaways = mainTakeaways;
    }

    // Update action items if provided
    if (actionItemIds !== undefined) {
      const actionItems = [];
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
      updates.actionItems = actionItems;
    }

    // Update questions if provided
    if (questionIds !== undefined) {
      const questions = [];
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
      updates.questions = questions;
    }

    // Update breakdown
    const updated = await this.breakdownRepository.update(breakdownId, updates);
    if (!updated) {
      throw new Error("Failed to update breakdown");
    }

    return updated;
  }
}




