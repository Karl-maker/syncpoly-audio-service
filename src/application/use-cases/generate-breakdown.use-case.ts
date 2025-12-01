import OpenAI from "openai";
import { Breakdown } from "../../domain/entities/breakdown";
import { Task } from "../../domain/entities/task";
import { Question } from "../../domain/entities/question";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { BreakdownRepository } from "../../infrastructure/database/repositories/breakdown.repository";
import { TranscriptRepository } from "../../infrastructure/database/repositories/transcript.repository";
import { TaskRepository } from "../../infrastructure/database/repositories/task.repository";
import { QuestionRepository } from "../../infrastructure/database/repositories/question.repository";
import { StructuredExtractionService } from "../services/structured-extraction.service";
import { randomUUID } from "crypto";

export interface GenerateBreakdownUseCaseParams {
  audioFileId: string;
  userId: string;
}

export class GenerateBreakdownUseCase {
  private openaiClient: OpenAI;
  private extractionService: StructuredExtractionService;

  constructor(
    private audioFileRepository: AudioFileRepository,
    private breakdownRepository: BreakdownRepository,
    private transcriptRepository: TranscriptRepository,
    private taskRepository: TaskRepository,
    private questionRepository: QuestionRepository,
    openaiApiKey: string
  ) {
    this.openaiClient = new OpenAI({ apiKey: openaiApiKey });
    this.extractionService = new StructuredExtractionService(openaiApiKey);
  }

  async execute(params: GenerateBreakdownUseCaseParams): Promise<Breakdown> {
    const { audioFileId, userId } = params;

    // Verify audio file exists and belongs to user
    const audioFile = await this.audioFileRepository.findById(audioFileId);
    if (!audioFile) {
      throw new Error(`Audio file with ID ${audioFileId} not found`);
    }
    if (audioFile.userId !== userId) {
      throw new Error("Unauthorized: Audio file does not belong to user");
    }

    // Check if breakdown already exists
    const existingBreakdown = await this.breakdownRepository.findByAudioFileId(audioFileId);
    if (existingBreakdown) {
      return existingBreakdown;
    }

    // Get transcript for the audio file
    if (!audioFile.s3Bucket || !audioFile.s3Key) {
      throw new Error("Audio file does not have S3 location information.");
    }
    const audioSourceId = `${audioFile.s3Bucket}/${audioFile.s3Key}`;
    const transcripts = await this.transcriptRepository.findByAudioSourceId(audioSourceId);

    if (transcripts.length === 0) {
      throw new Error(`No transcript found for audio file ID ${audioFileId}. Please process the audio first.`);
    }

    const transcript = transcripts[0];
    const transcriptText = transcript.segments.map((seg) => seg.text).join(" ");

    // Generate breakdown using OpenAI
    const breakdownPrompt = `Create a comprehensive breakdown of the following audio transcript.

Transcript:
${transcriptText}

Generate a structured breakdown with:
1. Introduction: A brief overview (2-3 sentences) of what the audio is about
2. Bullet Points: Key points mentioned in the audio (5-10 bullet points)
3. Main Takeaways: The most important insights or conclusions (3-5 takeaways)
4. Action Items: Any tasks, homework, or action items mentioned (extract with due dates if mentioned)
5. Questions: Generate 3-5 questions to test understanding (mix of true/false, multiple choice, and short answer)

Return the breakdown in a clear, structured format.`;

    const response = await this.openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert at creating structured breakdowns and summaries. Format your responses clearly with sections for Introduction, Bullet Points, Main Takeaways, Action Items, and Questions.",
        },
        {
          role: "user",
          content: breakdownPrompt,
        },
      ],
      temperature: 0.7,
    });

    const breakdownText = response.choices[0]?.message?.content || "";

    // Extract structured objects (tasks and questions) from the breakdown
    const extracted = await this.extractionService.extractStructuredObjects(
      breakdownText,
      userId,
      audioFileId
    );

    // Parse the breakdown text to extract sections
    const parsed = this.parseBreakdownText(breakdownText);

    // Store tasks and questions
    const storedTasks: Task[] = [];
    for (const task of extracted.tasks) {
      const stored = await this.taskRepository.create({
        userId: task.userId,
        audioFileId: task.audioFileId,
        description: task.description,
        dueDate: task.dueDate,
        priority: task.priority,
        status: task.status,
      });
      storedTasks.push(stored);
    }

    const storedQuestions: Question[] = [];
    for (const question of extracted.questions) {
      const stored = await this.questionRepository.create({
        userId: question.userId,
        audioFileId: question.audioFileId,
        type: question.type,
        question: question.question,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
      });
      storedQuestions.push(stored);
    }

    // Create breakdown entity
    const breakdown = await this.breakdownRepository.create({
      userId,
      audioFileId,
      introduction: parsed.introduction || "No introduction generated.",
      bulletPoints: parsed.bulletPoints || [],
      mainTakeaways: parsed.mainTakeaways || [],
      actionItems: storedTasks,
      questions: storedQuestions,
    });

    return breakdown;
  }

  /**
   * Parse breakdown text to extract structured sections
   */
  private parseBreakdownText(text: string): {
    introduction: string;
    bulletPoints: string[];
    mainTakeaways: string[];
  } {
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

    let introduction = "";
    const bulletPoints: string[] = [];
    const mainTakeaways: string[] = [];

    let currentSection: "introduction" | "bullets" | "takeaways" | null = null;

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      // Detect section headers
      if (lowerLine.includes("introduction") || lowerLine.includes("overview")) {
        currentSection = "introduction";
        continue;
      } else if (lowerLine.includes("bullet") || lowerLine.includes("key points") || lowerLine.includes("points:")) {
        currentSection = "bullets";
        continue;
      } else if (lowerLine.includes("takeaway") || lowerLine.includes("insight") || lowerLine.includes("conclusion")) {
        currentSection = "takeaways";
        continue;
      } else if (lowerLine.includes("action") || lowerLine.includes("question")) {
        // Stop parsing when we hit action items or questions (handled separately)
        break;
      }

      // Extract content based on current section
      if (currentSection === "introduction") {
        if (introduction) introduction += " ";
        introduction += line.replace(/^[-•*]\s*/, "");
      } else if (currentSection === "bullets") {
        const bullet = line.replace(/^[-•*]\s*/, "");
        if (bullet) bulletPoints.push(bullet);
      } else if (currentSection === "takeaways") {
        const takeaway = line.replace(/^[-•*]\s*/, "");
        if (takeaway) mainTakeaways.push(takeaway);
      } else if (!currentSection && !introduction) {
        // If no section detected yet, treat as introduction
        introduction = line;
        currentSection = "introduction";
      }
    }

    return {
      introduction: introduction || "No introduction available.",
      bulletPoints: bulletPoints.length > 0 ? bulletPoints : [],
      mainTakeaways: mainTakeaways.length > 0 ? mainTakeaways : [],
    };
  }
}

