import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/jwt.middleware";
import { config } from "../../infrastructure/config/app.config";
import { UploadAudioUseCase } from "../../application/use-cases/upload-audio.use-case";
import { UploadVideoUseCase } from "../../application/use-cases/upload-video.use-case";
import { UploadVideoFromUrlUseCase } from "../../application/use-cases/upload-video-from-url.use-case";
import { ProcessAudioUseCase } from "../../application/use-cases/process-audio.use-case";
import { GetMemoryUsageUseCase } from "../../application/use-cases/get-memory-usage.use-case";
import { GetUploadProgressUseCase } from "../../application/use-cases/get-upload-progress.use-case";
import { GetIncompleteUploadJobsUseCase } from "../../application/use-cases/get-incomplete-upload-jobs.use-case";
import { GetProcessingProgressUseCase } from "../../application/use-cases/get-processing-progress.use-case";
import { GetProcessingJobsUseCase } from "../../application/use-cases/get-processing-jobs.use-case";
import { GetTranscriptUseCase } from "../../application/use-cases/get-transcript.use-case";
import { UpdateTranscriptUseCase } from "../../application/use-cases/update-transcript.use-case";
import { GenerateBreakdownUseCase } from "../../application/use-cases/generate-breakdown.use-case";
import { CreateBreakdownUseCase } from "../../application/use-cases/create-breakdown.use-case";
import { UpdateBreakdownUseCase } from "../../application/use-cases/update-breakdown.use-case";
import { GetBreakdownUseCase } from "../../application/use-cases/get-breakdown.use-case";
import { DeleteBreakdownUseCase } from "../../application/use-cases/delete-breakdown.use-case";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { BreakdownRepository } from "../../infrastructure/database/repositories/breakdown.repository";
import { UploadAudioResponse, InitUploadV2Request, InitUploadV2Response, CompleteUploadV2Request } from "../dto/upload-audio.dto";
import { ProcessAudioRequest, ProcessAudioResponse } from "../dto/process-audio.dto";
import { MemoryUsageResponse, UsagePeriodResponse } from "../dto/memory-usage.dto";
import { CalculateUsagePeriodUseCase } from "../../application/use-cases/calculate-usage-period.use-case";
import { UploadProgressResponse } from "../dto/upload-progress.dto";
import { ProcessingProgressResponse } from "../dto/processing-progress.dto";
import { TranscriptResponse, toTranscriptResponse, UpdateTranscriptRequest } from "../dto/transcript.dto";
import { Transcript } from "../../domain/entities/transcript";
import { BreakdownResponse, toBreakdownResponse, CreateBreakdownRequest, UpdateBreakdownRequest } from "../dto/breakdown.dto";
import { GetQuestionsByAudioFileUseCase } from "../../application/use-cases/get-questions-by-audio-file.use-case";
import { GetTasksByAudioFileUseCase } from "../../application/use-cases/get-tasks-by-audio-file.use-case";
import { UpdateTaskStatusUseCase } from "../../application/use-cases/update-task-status.use-case";
import { DeleteTaskUseCase } from "../../application/use-cases/delete-task.use-case";
import { QuestionResponse, QuestionsResponse, toQuestionResponse } from "../dto/question.dto";
import { TaskResponse, TasksResponse, toTaskResponse, UpdateTaskStatusRequest } from "../dto/task.dto";
import { InitUploadV2UseCase } from "../../application/use-cases/init-upload-v2.use-case";
import { CompleteUploadAudioV2UseCase } from "../../application/use-cases/complete-upload-audio-v2.use-case";
import { CompleteUploadVideoV2UseCase } from "../../application/use-cases/complete-upload-video-v2.use-case";

export class AudioController {
  constructor(
    private uploadAudioUseCase: UploadAudioUseCase,
    private uploadVideoUseCase: UploadVideoUseCase,
    private uploadVideoFromUrlUseCase: UploadVideoFromUrlUseCase,
    private processAudioUseCase: ProcessAudioUseCase,
    private getMemoryUsageUseCase: GetMemoryUsageUseCase,
    private calculateUsagePeriodUseCase: CalculateUsagePeriodUseCase,
    private getUploadProgressUseCase: GetUploadProgressUseCase,
    private getIncompleteUploadJobsUseCase: GetIncompleteUploadJobsUseCase,
    private getProcessingProgressUseCase: GetProcessingProgressUseCase,
    private getProcessingJobsUseCase: GetProcessingJobsUseCase,
    private getTranscriptUseCase: GetTranscriptUseCase,
    private updateTranscriptUseCase: UpdateTranscriptUseCase,
    private generateBreakdownUseCase: GenerateBreakdownUseCase,
    private createBreakdownUseCase: CreateBreakdownUseCase,
    private updateBreakdownUseCase: UpdateBreakdownUseCase,
    private getBreakdownUseCase: GetBreakdownUseCase,
    private deleteBreakdownUseCase: DeleteBreakdownUseCase,
    private getQuestionsByAudioFileUseCase: GetQuestionsByAudioFileUseCase,
    private getTasksByAudioFileUseCase: GetTasksByAudioFileUseCase,
    private updateTaskStatusUseCase: UpdateTaskStatusUseCase,
    private deleteTaskUseCase: DeleteTaskUseCase,
    private initUploadV2UseCase: InitUploadV2UseCase,
    private completeUploadAudioV2UseCase: CompleteUploadAudioV2UseCase,
    private completeUploadVideoV2UseCase: CompleteUploadVideoV2UseCase,
    private audioFileRepository: AudioFileRepository,
    private breakdownRepository: BreakdownRepository
  ) {}

  async uploadAudio(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // Ensure region is explicitly set as a string
      const s3Region = config.aws.region || "us-east-1";
      if (typeof s3Region !== "string") {
        throw new Error("Invalid AWS_REGION configuration");
      }

      const uploadJob = await this.uploadAudioUseCase.execute({
        file: req.file,
        userId: req.user.userId,
        s3Bucket: config.aws.s3Bucket,
        cdnUrl: config.aws.cdnUrl, // Pass CDN URL if configured
        s3Config: config.aws.accessKeyId
          ? {
              region: s3Region,
              credentials: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey || "",
              },
              endpoint: config.aws.s3Endpoint,
              forcePathStyle: config.aws.s3ForcePathStyle,
            }
          : undefined,
      });

      const response: UploadAudioResponse = {
        jobId: uploadJob.id,
        status: uploadJob.status,
        message: "Upload started",
        audioFileId: uploadJob.audioFileId,
      };

      res.status(202).json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to upload audio" });
    }
  }

  async uploadVideo(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // Ensure region is explicitly set as a string
      const s3Region = config.aws.region || "us-east-1";
      if (typeof s3Region !== "string") {
        throw new Error("Invalid AWS_REGION configuration");
      }

      const uploadJob = await this.uploadVideoUseCase.execute({
        file: req.file,
        userId: req.user.userId,
        s3Bucket: config.aws.s3Bucket,
        cdnUrl: config.aws.cdnUrl, // Pass CDN URL if configured
        s3Config: config.aws.accessKeyId
          ? {
              region: s3Region,
              credentials: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey || "",
              },
              endpoint: config.aws.s3Endpoint,
              forcePathStyle: config.aws.s3ForcePathStyle,
            }
          : undefined,
      });

      const response: UploadAudioResponse = {
        jobId: uploadJob.id,
        status: uploadJob.status,
        message: "Video upload and conversion started",
        audioFileId: uploadJob.audioFileId,
      };

      res.status(202).json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to upload video" });
    }
  }

  async uploadVideoFromUrl(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { url, sizeLimit } = req.body;

      if (!url || typeof url !== "string") {
        res.status(400).json({ error: "URL is required and must be a string" });
        return;
      }

      // Validate sizeLimit if provided
      if (sizeLimit !== undefined) {
        if (typeof sizeLimit !== "number" || sizeLimit <= 0) {
          res.status(400).json({ error: "sizeLimit must be a positive number (duration in seconds)" });
          return;
        }
      }

      // Ensure region is explicitly set as a string
      const s3Region = config.aws.region || "us-east-1";
      if (typeof s3Region !== "string") {
        throw new Error("Invalid AWS_REGION configuration");
      }

      const uploadJob = await this.uploadVideoFromUrlUseCase.execute({
        url,
        userId: req.user.userId,
        sizeLimit,
        s3Bucket: config.aws.s3Bucket,
        cdnUrl: config.aws.cdnUrl,
        s3Config: config.aws.accessKeyId
          ? {
              region: s3Region,
              credentials: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey || "",
              },
              endpoint: config.aws.s3Endpoint,
              forcePathStyle: config.aws.s3ForcePathStyle,
            }
          : undefined,
      });

      const response: UploadAudioResponse = {
        jobId: uploadJob.id,
        status: uploadJob.status,
        message: "Video download and conversion started",
        audioFileId: uploadJob.audioFileId,
      };

      res.status(202).json(response);
    } catch (error: any) {
      // Check if it's a validation error (size limit exceeded)
      if (error.statusCode === 400 || error.message?.includes("exceeds the size limit")) {
        res.status(400).json({ error: error.message || "Video exceeds the size limit" });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to upload video from URL" });
    }
  }

  async processAudio(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { audioFileId, idempotencyKey, vectorStoreType, skipTranscription, skipEmbeddings, skipVectorStore, options } =
        req.body as ProcessAudioRequest;

      if (!audioFileId) {
        res.status(400).json({ error: "audioFileId is required" });
        return;
      }

      const job = await this.processAudioUseCase.execute({
        audioFileId,
        userId: req.user.userId,
        idempotencyKey,
        vectorStoreType,
        skipTranscription,
        skipEmbeddings,
        skipVectorStore,
        options,
        s3Config: config.aws.accessKeyId
          ? {
              region: config.aws.region,
              credentials: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey || "",
              },
            }
          : undefined,
      });

      const response: ProcessAudioResponse = {
        jobId: job.id,
        status: job.status,
        transcriptId: job.transcriptId,
        message: "Processing started",
      };

      res.status(202).json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to process audio" });
    }
  }

  async getMemoryUsage(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const userId = req.params.userId || req.user.userId;

      // Only allow users to view their own memory usage
      if (userId !== req.user.userId) {
        console.log(`${userId} is not the same as ${req.user.userId}`);
        res.status(403).json({ error: "Forbidden: Cannot view other users' memory usage" });
        return;
      }

      const memoryUsage = await this.getMemoryUsageUseCase.execute({
        userId,
      });

      const response: MemoryUsageResponse = {
        userId: memoryUsage.userId,
        totalAudioFiles: memoryUsage.totalAudioFiles,
        totalStorageBytes: memoryUsage.totalStorageBytes,
        totalStorageMB: memoryUsage.totalStorageBytes / (1024 * 1024),
        totalStorageGB: memoryUsage.totalStorageBytes / (1024 * 1024 * 1024),
        totalVectorStoreRecords: memoryUsage.totalVectorStoreRecords,
        vectorStoreMemoryBytes: memoryUsage.vectorStoreMemoryBytes,
        vectorStoreMemoryMB: memoryUsage.vectorStoreMemoryBytes
          ? memoryUsage.vectorStoreMemoryBytes / (1024 * 1024)
          : undefined,
        totalAudioProcessedSeconds: memoryUsage.totalAudioProcessedSeconds,
        totalAudioProcessedMinutes: memoryUsage.totalAudioProcessedSeconds / 60,
        totalAICreditsUsed: memoryUsage.totalAICreditsUsed,
        totalChatTokens: memoryUsage.totalChatTokens,
        totalChatCreditsUsed: memoryUsage.totalChatCreditsUsed,
        provider: memoryUsage.provider,
        processLog: memoryUsage.processLog,
        lastCalculatedAt: memoryUsage.lastCalculatedAt,
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get memory usage" });
    }
  }

  async calculateUsagePeriod(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const userId = req.user.userId;
      const startDateStr = req.query.startDate as string;
      const endDateStr = req.query.endDate as string;

      if (!startDateStr || !endDateStr) {
        res.status(400).json({ error: "startDate and endDate query parameters are required (ISO 8601 format)" });
        return;
      }

      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ error: "Invalid date format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)" });
        return;
      }

      if (startDate > endDate) {
        res.status(400).json({ error: "startDate must be before or equal to endDate" });
        return;
      }

      const usagePeriod = await this.calculateUsagePeriodUseCase.execute({
        userId,
        startDate,
        endDate,
      });

      const response: UsagePeriodResponse = {
        userId: usagePeriod.userId,
        period: usagePeriod.period,
        totalStorageBytes: usagePeriod.totalStorageBytes,
        totalStorageMB: usagePeriod.totalStorageBytes / (1024 * 1024),
        totalStorageGB: usagePeriod.totalStorageBytes / (1024 * 1024 * 1024),
        totalAudioProcessedSeconds: usagePeriod.totalAudioProcessedSeconds,
        totalAudioProcessedMinutes: usagePeriod.totalAudioProcessedMinutes,
        totalAICreditsUsed: usagePeriod.totalAICreditsUsed,
        totalChatTokens: usagePeriod.totalChatTokens,
        totalChatCreditsUsed: usagePeriod.totalChatCreditsUsed,
        provider: usagePeriod.provider,
        processLog: usagePeriod.processLog,
        calculatedAt: usagePeriod.calculatedAt,
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to calculate usage period" });
    }
  }

  async getUploadProgress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const jobId = req.params.jobId;

      if (!jobId) {
        res.status(400).json({ error: "jobId is required" });
        return;
      }

      const job = await this.getUploadProgressUseCase.execute({
        jobId,
        userId: req.user.userId,
      });

      const response: UploadProgressResponse = {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        audioFileId: job.audioFileId,
        filename: job.filename,
        s3Bucket: job.s3Bucket,
        s3Key: job.s3Key,
        error: job.error,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
      };

      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to get upload progress" });
    }
  }

  async getIncompleteUploadJobs(req: AuthenticatedRequest, res: Response): Promise<void> {

    
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // Get pagination parameters from query string
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;

      const result = await this.getIncompleteUploadJobsUseCase.execute({
        userId: req?.user?.userId || "",
        page,
        limit,
      });

      const responses: UploadProgressResponse[] = result.jobs.map((job) => ({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        audioFileId: job.audioFileId,
        filename: job.filename,
        s3Bucket: job.s3Bucket,
        s3Key: job.s3Key,
        videoS3Bucket: job.videoS3Bucket,
        videoS3Key: job.videoS3Key,
        error: job.error,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
      }));

      res.status(200).json({
        jobs: responses,
        pagination: {
          total: result.total,
          totalPages: result.totalPages,
          currentPage: result.currentPage,
          limit,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get incomplete upload jobs" });
    }
  }

  async getProcessingProgress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const jobId = req.params.jobId;

      if (!jobId) {
        res.status(400).json({ error: "jobId is required" });
        return;
      }

      const job = await this.getProcessingProgressUseCase.execute({
        jobId,
        userId: req.user.userId,
      });

      const response: ProcessingProgressResponse = {
        jobId: job.id,
        audioFileId: job.audioFileId,
        status: job.status,
        progress: job.progress,
        transcriptId: job.transcriptId,
        vectorStoreType: job.vectorStoreType,
        error: job.error,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };

      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to get processing progress" });
    }
  }

  async getProcessingJobs(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const jobs = await this.getProcessingJobsUseCase.execute({
        userId: req.user.userId,
      });

      const responses: ProcessingProgressResponse[] = jobs.map((job) => ({
        jobId: job.id,
        audioFileId: job.audioFileId,
        status: job.status,
        progress: job.progress,
        transcriptId: job.transcriptId,
        vectorStoreType: job.vectorStoreType,
        error: job.error,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }));

      res.status(200).json({
        jobs: responses,
        count: responses.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get processing jobs" });
    }
  }

  async getTranscript(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const audioFileId = req.params.audioFileId;
      const orderIndex = req.query.orderIndex ? parseInt(req.query.orderIndex as string, 10) : undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

      if (!audioFileId) {
        res.status(400).json({ error: "audioFileId is required" });
        return;
      }

      const result = await this.getTranscriptUseCase.execute({
        audioFileId,
        userId: req.user.userId,
        orderIndex,
        page,
        limit,
      });

      if (!result) {
        res.status(404).json({ error: "Transcript not found for this audio file" });
        return;
      }

      // Always return the same structure regardless of orderIndex or pagination
      const useCaseResult = result as { transcripts: Transcript[]; pagination?: any; completed: boolean };
      const responses = useCaseResult.transcripts.map((t) => toTranscriptResponse(t));
      
      const response: any = {
        transcripts: responses,
        count: responses.length,
        completed: useCaseResult.completed,
      };

      if (useCaseResult.pagination) {
        response.pagination = useCaseResult.pagination;
      }

      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to get transcript" });
    }
  }

  async updateTranscript(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const transcriptId = req.params.transcriptId;
      const { speakers, segments } = req.body as UpdateTranscriptRequest;

      if (!transcriptId) {
        res.status(400).json({ error: "transcriptId is required" });
        return;
      }

      if (!speakers && !segments) {
        res.status(400).json({ error: "At least one of 'speakers' or 'segments' must be provided" });
        return;
      }

      const transcript = await this.updateTranscriptUseCase.execute({
        transcriptId,
        userId: req.user.userId,
        speakers,
        segments,
      });

      const response: TranscriptResponse = toTranscriptResponse(transcript);
      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to update transcript" });
    }
  }

  async generateBreakdown(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const audioFileId = req.params.audioFileId;

      if (!audioFileId) {
        res.status(400).json({ error: "audioFileId is required" });
        return;
      }

      const breakdown = await this.generateBreakdownUseCase.execute({
        audioFileId,
        userId: req.user.userId,
      });

      const response: BreakdownResponse = toBreakdownResponse(breakdown);

      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to generate breakdown" });
    }
  }

  async getBreakdowns(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const audioFileId = req.params.audioFileId;

      if (!audioFileId) {
        res.status(400).json({ error: "audioFileId is required" });
        return;
      }

      // Verify audio file belongs to user
      const audioFile = await this.audioFileRepository.findById(audioFileId);
      if (!audioFile) {
        res.status(404).json({ error: "Audio file not found" });
        return;
      }
      if (audioFile.userId !== req.user.userId) {
        res.status(403).json({ error: "Unauthorized: Audio file does not belong to user" });
        return;
      }

      const breakdowns = await this.breakdownRepository.findByAudioFileId(audioFileId);
      const responses = breakdowns.map((b) => toBreakdownResponse(b));

      res.status(200).json({ breakdowns: responses, count: responses.length });
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to get breakdowns" });
    }
  }

  async getBreakdown(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const breakdownId = req.params.breakdownId;

      if (!breakdownId) {
        res.status(400).json({ error: "breakdownId is required" });
        return;
      }

      const breakdown = await this.getBreakdownUseCase.execute({
        breakdownId,
        userId: req.user.userId,
      });

      const response: BreakdownResponse = toBreakdownResponse(breakdown);
      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to get breakdown" });
    }
  }

  async createBreakdown(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { audioFileId, introduction, bulletPoints, mainTakeaways, actionItemIds, questionIds } = req.body as CreateBreakdownRequest;

      if (!audioFileId || !introduction) {
        res.status(400).json({ error: "audioFileId and introduction are required" });
        return;
      }

      const breakdown = await this.createBreakdownUseCase.execute({
        audioFileId,
        userId: req.user.userId,
        introduction,
        bulletPoints: bulletPoints || [],
        mainTakeaways: mainTakeaways || [],
        actionItemIds,
        questionIds,
      });

      const response: BreakdownResponse = toBreakdownResponse(breakdown);
      res.status(201).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized") || error.message?.includes("already exists")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to create breakdown" });
    }
  }

  async updateBreakdown(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const breakdownId = req.params.breakdownId;
      const { introduction, bulletPoints, mainTakeaways, actionItemIds, questionIds } = req.body as UpdateBreakdownRequest;

      if (!breakdownId) {
        res.status(400).json({ error: "breakdownId is required" });
        return;
      }

      const breakdown = await this.updateBreakdownUseCase.execute({
        breakdownId,
        userId: req.user.userId,
        introduction,
        bulletPoints,
        mainTakeaways,
        actionItemIds,
        questionIds,
      });

      const response: BreakdownResponse = toBreakdownResponse(breakdown);
      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to update breakdown" });
    }
  }

  async deleteBreakdown(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const breakdownId = req.params.breakdownId;

      if (!breakdownId) {
        res.status(400).json({ error: "breakdownId is required" });
        return;
      }

      await this.deleteBreakdownUseCase.execute({
        breakdownId,
        userId: req.user.userId,
      });

      res.status(204).send();
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to delete breakdown" });
    }
  }

  async getAudioFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // Get pagination parameters from query string
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      // Validate pagination parameters
      const validPage = Math.max(1, page);
      const validLimit = Math.max(1, Math.min(100, limit)); // Limit between 1 and 100

      const result = await this.audioFileRepository.findByUserIdPaginated(
        req.user.userId,
        validPage,
        validLimit
      );

      // Transform audio files to hide S3 bucket info and add CDN URLs
      const cdnUrl = config.aws.cdnUrl;
      const transformedFiles = result.files.map((file) => {
        const { s3Bucket, s3Key, videoSourceS3Bucket, videoSourceS3Key, parts, ...rest } = file;
        
        // Build URL: ALWAYS use the original whole file, NEVER use parts
        // Priority: videoSourceS3Key (original video mp4) > s3Key (original whole file mp3/audio) > NEVER parts
        // s3Key should point to the original whole file, not the first part
        const keyToUse = videoSourceS3Key || s3Key;
        let url: string | undefined;
        if (cdnUrl && keyToUse) {
          const cdnBase = cdnUrl.replace(/\/$/, "");
          // CDN URL format: https://cdn.example.com/key (no bucket name)
          // Ensure we're not using a part key (parts have "-part-" in the key)
          if (keyToUse.includes("-part-")) {
            console.warn(`[AudioController] Warning: s3Key appears to be a part key: ${keyToUse}. This should not happen.`);
          }
          url = `${cdnBase}/${keyToUse}`;
        } else if (file.cdnUrl) {
          // Use existing CDN URL if available (but remove bucket name if present)
          const existingUrl = file.cdnUrl;
          // Remove bucket name from existing CDN URL if it's in the format cdn/bucket/key
          // Pattern: https://cdn.example.com/bucket/key -> https://cdn.example.com/key
          const urlMatch = existingUrl.match(/^(https?:\/\/[^\/]+)\/([^\/]+)\/(.+)$/);
          if (urlMatch) {
            // URL has bucket name, remove it
            const [, protocolAndDomain, bucket, key] = urlMatch;
            url = `${protocolAndDomain}/${key}`;
          } else {
            url = existingUrl;
          }
        }

        // Transform parts if they exist
        const transformedParts = parts?.map((part) => {
          const { s3Key: partKey, ...partRest } = part;
          
          // Build part URL: use CDN URL if configured (no bucket name)
          let partUrl: string | undefined;
          if (cdnUrl && partKey) {
            const cdnBase = cdnUrl.replace(/\/$/, "");
            partUrl = `${cdnBase}/${partKey}`;
          } else if (part.cdnUrl) {
            // Use existing CDN URL if available (but remove bucket name if present)
            const existingPartUrl = part.cdnUrl;
            // Pattern: https://cdn.example.com/bucket/key -> https://cdn.example.com/key
            const urlMatch = existingPartUrl.match(/^(https?:\/\/[^\/]+)\/([^\/]+)\/(.+)$/);
            if (urlMatch) {
              // URL has bucket name, remove it
              const [, protocolAndDomain, bucket, key] = urlMatch;
              partUrl = `${protocolAndDomain}/${key}`;
            } else {
              partUrl = existingPartUrl;
            }
          }

          return {
            ...partRest,
            url: partUrl,
          };
        });

        return {
          ...rest,
          url,
          ...(transformedParts && { parts: transformedParts }),
        };
      });

      res.status(200).json({
        audioFiles: transformedFiles,
        pagination: {
          total: result.total,
          totalPages: result.totalPages,
          currentPage: result.currentPage,
          limit: validLimit,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get audio files" });
    }
  }

  async getQuestionsByAudioFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { audioFileId } = req.params;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

      const result = await this.getQuestionsByAudioFileUseCase.execute({
        audioFileId,
        userId: req.user.userId,
        page,
        limit,
      });

      const response: QuestionsResponse = {
        questions: result.questions.map(toQuestionResponse),
        pagination: result.pagination,
      };
      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to get questions" });
    }
  }

  async getTasksByAudioFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { audioFileId } = req.params;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

      const result = await this.getTasksByAudioFileUseCase.execute({
        audioFileId,
        userId: req.user.userId,
        page,
        limit,
      });

      const response: TasksResponse = {
        tasks: result.tasks.map(toTaskResponse),
        pagination: result.pagination,
      };
      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to get tasks" });
    }
  }

  async updateTaskStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { taskId } = req.params;
      const { status } = req.body as UpdateTaskStatusRequest;

      if (!status || !["pending", "in-progress", "completed"].includes(status)) {
        res.status(400).json({ error: "Invalid status. Must be 'pending', 'in-progress', or 'completed'" });
        return;
      }

      const updatedTask = await this.updateTaskStatusUseCase.execute({
        taskId,
        userId: req.user.userId,
        status,
      });

      const response: TaskResponse = toTaskResponse(updatedTask);
      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to update task status" });
    }
  }

  async deleteTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { taskId } = req.params;

      await this.deleteTaskUseCase.execute({
        taskId,
        userId: req.user.userId,
      });

      res.status(204).send();
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Unauthorized")) {
        res.status(403).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to delete task" });
    }
  }

  // V2 Upload Endpoints (using S3 presigned URLs)

  /**
   * Initialize upload (v2) - Returns presigned URL for direct S3 upload
   */
  async initUploadV2(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { filename, contentType, fileSize } = req.body as InitUploadV2Request;

      if (!filename || typeof filename !== "string") {
        res.status(400).json({ error: "filename is required and must be a string" });
        return;
      }

      if (!contentType || typeof contentType !== "string") {
        res.status(400).json({ error: "contentType is required and must be a string" });
        return;
      }

      // Validate content type
      const isAudio = contentType.startsWith("audio/");
      const isVideo = contentType.startsWith("video/");
      if (!isAudio && !isVideo) {
        res.status(400).json({ error: "contentType must be audio/* or video/*" });
        return;
      }

      // Ensure region is explicitly set as a string
      const s3Region = config.aws.region || "us-east-1";
      if (typeof s3Region !== "string") {
        throw new Error("Invalid AWS_REGION configuration");
      }

      const result = await this.initUploadV2UseCase.execute({
        filename,
        contentType,
        fileSize: fileSize ? parseInt(fileSize as any, 10) : undefined,
        userId: req.user.userId,
        s3Bucket: config.aws.s3Bucket,
        s3Config: config.aws.accessKeyId
          ? {
              region: s3Region,
              credentials: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey || "",
              },
              endpoint: config.aws.s3Endpoint,
              forcePathStyle: config.aws.s3ForcePathStyle,
            }
          : undefined,
      });

      const response: InitUploadV2Response = {
        jobId: result.jobId,
        uploadUrl: result.uploadUrl,
        s3Key: result.s3Key,
        s3Bucket: result.s3Bucket,
        expiresIn: result.expiresIn,
        status: "pending",
        message: "Upload URL generated. Upload file to the provided URL, then call complete endpoint.",
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to initialize upload" });
    }
  }

  /**
   * Complete audio upload (v2) - Processes file uploaded to S3 via presigned URL
   */
  async completeUploadAudioV2(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { jobId } = req.body as CompleteUploadV2Request;

      if (!jobId || typeof jobId !== "string") {
        res.status(400).json({ error: "jobId is required and must be a string" });
        return;
      }

      // Ensure region is explicitly set as a string
      const s3Region = config.aws.region || "us-east-1";
      if (typeof s3Region !== "string") {
        throw new Error("Invalid AWS_REGION configuration");
      }

      const uploadJob = await this.completeUploadAudioV2UseCase.execute({
        jobId,
        userId: req.user.userId,
        s3Bucket: config.aws.s3Bucket,
        cdnUrl: config.aws.cdnUrl,
        s3Config: config.aws.accessKeyId
          ? {
              region: s3Region,
              credentials: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey || "",
              },
              endpoint: config.aws.s3Endpoint,
              forcePathStyle: config.aws.s3ForcePathStyle,
            }
          : undefined,
      });

      const response: UploadAudioResponse = {
        jobId: uploadJob.id,
        status: uploadJob.status,
        message: "Upload processing started",
        audioFileId: uploadJob.audioFileId,
      };

      res.status(202).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found") || error.message?.includes("Unauthorized")) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to complete upload" });
    }
  }

  /**
   * Complete video upload (v2) - Processes video uploaded to S3 via presigned URL
   */
  async completeUploadVideoV2(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { jobId } = req.body as CompleteUploadV2Request;

      if (!jobId || typeof jobId !== "string") {
        res.status(400).json({ error: "jobId is required and must be a string" });
        return;
      }

      // Ensure region is explicitly set as a string
      const s3Region = config.aws.region || "us-east-1";
      if (typeof s3Region !== "string") {
        throw new Error("Invalid AWS_REGION configuration");
      }

      const uploadJob = await this.completeUploadVideoV2UseCase.execute({
        jobId,
        userId: req.user.userId,
        s3Bucket: config.aws.s3Bucket,
        cdnUrl: config.aws.cdnUrl,
        s3Config: config.aws.accessKeyId
          ? {
              region: s3Region,
              credentials: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey || "",
              },
              endpoint: config.aws.s3Endpoint,
              forcePathStyle: config.aws.s3ForcePathStyle,
            }
          : undefined,
      });

      const response: UploadAudioResponse = {
        jobId: uploadJob.id,
        status: uploadJob.status,
        message: "Video upload and conversion started",
        audioFileId: uploadJob.audioFileId,
      };

      res.status(202).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found") || error.message?.includes("Unauthorized")) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to complete video upload" });
    }
  }
}

