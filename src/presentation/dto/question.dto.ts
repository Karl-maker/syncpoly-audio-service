import { Question } from "../../domain/entities/question";

export interface QuestionResponse {
  id: string;
  userId: string;
  audioFileId?: string;
  type: "true-false" | "multiple-choice";
  question: string;
  options?: Array<{
    id: string;
    text: string;
    isCorrect?: boolean;
  }>;
  correctAnswer?: string;
  explanation?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionsResponse {
  questions: QuestionResponse[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function toQuestionResponse(question: Question): QuestionResponse {
  return {
    id: question.id,
    userId: question.userId,
    audioFileId: question.audioFileId,
    type: question.type,
    question: question.question,
    options: question.options,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}

