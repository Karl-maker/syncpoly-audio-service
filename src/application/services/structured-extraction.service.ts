import OpenAI from "openai";
import { Task } from "../../domain/entities/task";
import { Question, QuestionType } from "../../domain/entities/question";
import { randomUUID } from "crypto";

export interface ExtractedObjects {
  tasks: Task[];
  questions: Question[];
  tokens?: number; // Total token usage from extraction API call
  promptTokens?: number; // Prompt tokens from extraction API call
  completionTokens?: number; // Completion tokens from extraction API call
}

export class StructuredExtractionService {
  private openaiClient: OpenAI;

  constructor(apiKey: string) {
    this.openaiClient = new OpenAI({ apiKey });
  }

  /**
   * Extract tasks and questions from AI response text
   * @param responseText The AI response text to analyze
   * @param userId The user ID
   * @param audioFileId Optional audio file ID
   * @param extractQuestions Whether to extract questions (only true if user explicitly requested questions)
   * @param extractTasks Whether to extract tasks (only true if user explicitly requested tasks)
   */
  async extractStructuredObjects(
    responseText: string,
    userId: string,
    audioFileId?: string,
    extractQuestions: boolean = false,
    extractTasks: boolean = false
  ): Promise<ExtractedObjects> {
    try {
      const tasksInstruction = extractTasks
        ? "1. Tasks/Action Items/Homework: Extract any items that need to be done, with due dates if mentioned, descriptions, priority if inferable, and location if mentioned."
        : "1. Tasks/Action Items/Homework: DO NOT extract tasks. Only extract tasks if the user explicitly requested them (e.g., 'extract tasks', 'create tasks', 'action items', 'homework'). Return an empty array for tasks.";

      const questionsInstruction = extractQuestions 
        ? "2. Questions: Extract any questions that could be used for testing/learning (true-false or multiple choice only - NO short answer questions)."
        : "2. Questions: DO NOT extract questions. Only extract questions if the user explicitly requested them (e.g., 'generate questions', 'create quiz', 'test me'). Return an empty array for questions.";

      const extractionPrompt = `Analyze the following text and extract${extractTasks ? " tasks/action items/homework" : ""}${extractTasks && extractQuestions ? " and" : ""}${extractQuestions ? " questions" : ""}${!extractTasks && !extractQuestions ? " nothing (return empty arrays)" : ""} that are mentioned.

Text to analyze:
${responseText}

Extract:
${tasksInstruction}
${questionsInstruction}

Return a JSON object with this structure:
{
  "tasks": [
    {
      "description": "string (required)",
      "dueDate": "ISO date string (optional, only if mentioned)",
      "priority": "low|medium|high (optional, infer from context)",
      "location": "string (optional, only if a location is mentioned)"
    }
  ],
  "questions": [
    {
      "type": "true-false|multiple-choice",
      "question": "string (required)",
      "options": [{"id": "string", "text": "string", "isCorrect": boolean}], // Required for multiple-choice and true-false. For true-false, mark which option (True or False) is correct.
      "correctAnswer": "string (optional, for reference. For true-false, use 'true' or 'false')",
      "explanation": "string (optional)"
    }
  ]
}

IMPORTANT: For true-false questions, you MUST:
- Include both "True" and "False" options
- Set isCorrect: true for the correct option and isCorrect: false for the incorrect option
- Set correctAnswer to "true" or "false" to indicate the correct answer

${!extractTasks ? "CRITICAL: Do NOT extract tasks unless explicitly requested by the user. Return an empty array for tasks." : ""}
${!extractQuestions ? "CRITICAL: Do NOT extract questions unless explicitly requested by the user. Return an empty array for questions." : ""}

If no tasks or questions are found, return empty arrays. Only extract items that are clearly tasks or questions.`;

      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a structured data extraction assistant. Extract tasks and questions from text and return valid JSON only.",
          },
          {
            role: "user",
            content: extractionPrompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3, // Lower temperature for more consistent extraction
      });

      // Extract token usage from OpenAI response
      const tokens = response.usage?.total_tokens || 0;
      const promptTokens = response.usage?.prompt_tokens || 0;
      const completionTokens = response.usage?.completion_tokens || 0;

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { tasks: [], questions: [], tokens, promptTokens, completionTokens };
      }

      const parsed = JSON.parse(content) as {
        tasks?: Array<{
          description: string;
          dueDate?: string;
          priority?: "low" | "medium" | "high";
          location?: string;
        }>;
        questions?: Array<{
          type: string;
          question: string;
          options?: Array<{ id: string; text: string; isCorrect?: boolean }>;
          correctAnswer?: string;
          explanation?: string;
        }>;
      };

      // Validate and convert to domain entities
      const tasks: Task[] = (parsed.tasks || [])
        .filter((t) => t.description && t.description.trim().length > 0)
        .map((t) => ({
          id: randomUUID(),
          userId,
          audioFileId,
          description: t.description.trim(),
          dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
          priority: t.priority || undefined,
          location: t.location?.trim() || undefined,
          status: "pending" as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));

      const questions: Question[] = (parsed.questions || [])
        .filter((q) => {
          // Filter out invalid questions first
          if (!q.question || q.question.trim().length === 0) {
            return false;
          }
          const type = this.validateQuestionType(q.type);
          return type !== null;
        })
        .map((q) => {
          const type = this.validateQuestionType(q.type)!; // Safe because we filtered above

          // Validate options for multiple-choice and true-false
          let options: Question["options"] = undefined;
          if (type === "multiple-choice") {
            if (q.options && Array.isArray(q.options) && q.options.length > 0) {
              // Use provided options
              options = q.options.map((opt) => ({
                id: opt.id || randomUUID(),
                text: opt.text || "",
                isCorrect: opt.isCorrect,
              }));
            }
          } else if (type === "true-false") {
            // For true-false questions, always create True/False options
            if (q.options && Array.isArray(q.options) && q.options.length > 0) {
              // Use provided options if they exist
              options = q.options.map((opt) => ({
                id: opt.id || randomUUID(),
                text: opt.text || "",
                isCorrect: opt.isCorrect,
              }));
            } else {
              // Create default true/false options - determine correct answer from correctAnswer field
              const correctAnswer = q.correctAnswer?.toLowerCase().trim();
              const isTrueCorrect = correctAnswer === "true" || correctAnswer === "t";
              options = [
                { id: randomUUID(), text: "True", isCorrect: isTrueCorrect },
                { id: randomUUID(), text: "False", isCorrect: !isTrueCorrect },
              ];
            }
          }

          return {
            id: randomUUID(),
            userId,
            audioFileId,
            type,
            question: q.question.trim(),
            options,
            correctAnswer: q.correctAnswer || undefined,
            explanation: q.explanation || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        });

      return { tasks, questions, tokens, promptTokens, completionTokens };
    } catch (error) {
      console.error("[StructuredExtractionService] Error extracting structured objects:", error);
      // Fallback: return empty arrays on error
      return { tasks: [], questions: [], tokens: 0, promptTokens: 0, completionTokens: 0 };
    }
  }

  private validateQuestionType(type: string): QuestionType | null {
    const validTypes: QuestionType[] = ["true-false", "multiple-choice"];
    if (validTypes.includes(type as QuestionType)) {
      return type as QuestionType;
    }
    return null;
  }
}

