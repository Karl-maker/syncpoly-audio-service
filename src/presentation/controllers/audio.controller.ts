import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/jwt.middleware";
import { config } from "../../infrastructure/config/app.config";
import { UploadAudioUseCase } from "../../application/use-cases/upload-audio.use-case";
import { ProcessAudioUseCase } from "../../application/use-cases/process-audio.use-case";
import { GetMemoryUsageUseCase } from "../../application/use-cases/get-memory-usage.use-case";
import { GetUploadProgressUseCase } from "../../application/use-cases/get-upload-progress.use-case";
import { GetProcessingProgressUseCase } from "../../application/use-cases/get-processing-progress.use-case";
import { GetTranscriptUseCase } from "../../application/use-cases/get-transcript.use-case";
import { GenerateBreakdownUseCase } from "../../application/use-cases/generate-breakdown.use-case";
import { CreateBreakdownUseCase } from "../../application/use-cases/create-breakdown.use-case";
import { UpdateBreakdownUseCase } from "../../application/use-cases/update-breakdown.use-case";
import { GetBreakdownUseCase } from "../../application/use-cases/get-breakdown.use-case";
import { DeleteBreakdownUseCase } from "../../application/use-cases/delete-breakdown.use-case";
import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { BreakdownRepository } from "../../infrastructure/database/repositories/breakdown.repository";
import { UploadAudioResponse } from "../dto/upload-audio.dto";
import { ProcessAudioRequest, ProcessAudioResponse } from "../dto/process-audio.dto";
import { MemoryUsageResponse } from "../dto/memory-usage.dto";
import { UploadProgressResponse } from "../dto/upload-progress.dto";
import { ProcessingProgressResponse } from "../dto/processing-progress.dto";
import { TranscriptResponse, toTranscriptResponse } from "../dto/transcript.dto";
import { BreakdownResponse, toBreakdownResponse, CreateBreakdownRequest, UpdateBreakdownRequest } from "../dto/breakdown.dto";

export class AudioController {
  constructor(
    private uploadAudioUseCase: UploadAudioUseCase,
    private processAudioUseCase: ProcessAudioUseCase,
    private getMemoryUsageUseCase: GetMemoryUsageUseCase,
    private getUploadProgressUseCase: GetUploadProgressUseCase,
    private getProcessingProgressUseCase: GetProcessingProgressUseCase,
    private getTranscriptUseCase: GetTranscriptUseCase,
    private generateBreakdownUseCase: GenerateBreakdownUseCase,
    private createBreakdownUseCase: CreateBreakdownUseCase,
    private updateBreakdownUseCase: UpdateBreakdownUseCase,
    private getBreakdownUseCase: GetBreakdownUseCase,
    private deleteBreakdownUseCase: DeleteBreakdownUseCase,
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
        lastCalculatedAt: memoryUsage.lastCalculatedAt,
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get memory usage" });
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

  async getTranscript(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const audioFileId = req.params.audioFileId;
      const orderIndex = req.query.orderIndex ? parseInt(req.query.orderIndex as string, 10) : undefined;

      if (!audioFileId) {
        res.status(400).json({ error: "audioFileId is required" });
        return;
      }

      const result = await this.getTranscriptUseCase.execute({
        audioFileId,
        userId: req.user.userId,
        orderIndex,
      });

      if (!result) {
        res.status(404).json({ error: "Transcript not found for this audio file" });
        return;
      }

      // Handle both single transcript and array of transcripts
      if (Array.isArray(result)) {
        const responses = result.map((t) => toTranscriptResponse(t));
        res.status(200).json({ transcripts: responses, count: responses.length });
      } else {
        const response: TranscriptResponse = toTranscriptResponse(result);
        res.status(200).json(response);
      }
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
}

