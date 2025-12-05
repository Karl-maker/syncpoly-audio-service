export type QuestionType = "true-false" | "multiple-choice";

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect?: boolean; // For multiple choice and true/false
}

export interface Question {
  id: string;
  userId: string;
  audioFileId?: string; // Optional: if question is related to a specific audio file
  type: QuestionType;
  question: string; // The question text
  options?: QuestionOption[]; // Required for multiple-choice, optional for others
  correctAnswer?: string; // For reference (e.g., true/false for true-false questions)
  explanation?: string; // Optional explanation or context
  createdAt: Date;
  updatedAt: Date;
}







