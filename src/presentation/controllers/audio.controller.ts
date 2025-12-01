import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/jwt.middleware";
import { config } from "../../infrastructure/config/app.config";
import { UploadAudioUseCase } from "../../application/use-cases/upload-audio.use-case";
import { ProcessAudioUseCase } from "../../application/use-cases/process-audio.use-case";
import { GetMemoryUsageUseCase } from "../../application/use-cases/get-memory-usage.use-case";
import { UploadAudioResponse } from "../dto/upload-audio.dto";
import { ProcessAudioResponse } from "../dto/process-audio.dto";
import { MemoryUsageResponse } from "../dto/memory-usage.dto";

export class AudioController {
  constructor(
    private uploadAudioUseCase: UploadAudioUseCase,
    private processAudioUseCase: ProcessAudioUseCase,
    private getMemoryUsageUseCase: GetMemoryUsageUseCase
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

      const audioFile = await this.uploadAudioUseCase.execute({
        file: req.file,
        userId: req.user.userId,
        s3Bucket: config.aws.s3Bucket,
        s3Config: config.aws.accessKeyId
          ? {
              region: config.aws.region,
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
        id: audioFile.id,
        filename: audioFile.filename,
        s3Uri: audioFile.s3Uri,
        fileSize: audioFile.fileSize,
        uploadedAt: audioFile.uploadedAt,
      };

      res.status(201).json(response);
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

      const { audioFileId, vectorStoreType, skipTranscription, skipEmbeddings, skipVectorStore, options } =
        req.body;

      if (!audioFileId) {
        res.status(400).json({ error: "audioFileId is required" });
        return;
      }

      const job = await this.processAudioUseCase.execute({
        audioFileId,
        userId: req.user.userId,
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
}

