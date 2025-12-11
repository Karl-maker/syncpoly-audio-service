import { randomUUID } from "crypto";
import { UploadJob } from "../../domain/entities/upload-job";
import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { S3AudioStorage, S3AudioStorageConfig } from "../../infrastructure/aws/s3.audio.storage";

export interface InitUploadV2UseCaseParams {
  filename: string;
  contentType: string;
  fileSize?: number;
  userId: string;
  s3Config?: S3AudioStorageConfig;
  s3Bucket?: string;
}

export interface InitUploadV2Result {
  jobId: string;
  uploadUrl: string;
  s3Key: string;
  s3Bucket: string;
  expiresIn: number;
}

export class InitUploadV2UseCase {
  constructor(
    private uploadJobRepository: UploadJobRepository,
    private s3Storage?: S3AudioStorage
  ) {}

  async execute(params: InitUploadV2UseCaseParams): Promise<InitUploadV2Result> {
    const { filename, contentType, fileSize, userId, s3Bucket } = params;

    if (!this.s3Storage || !s3Bucket) {
      throw new Error("S3 storage is not configured");
    }

    // Create upload job
    const uploadJob = await this.uploadJobRepository.create({
      userId,
      filename,
      status: "pending",
      progress: 0,
    } as Omit<UploadJob, "id" | "createdAt" | "updatedAt">);

    // Generate S3 key
    const fileExtension = filename.split(".").pop() || "";
    const sanitizedFilename = filename.replace(/[<>:"/\\|?*]/g, "").trim();
    const s3Key = `users/${userId}/uploads/${randomUUID()}-${sanitizedFilename}`;

    // Generate presigned URL (expires in 1 hour)
    const expiresIn = 3600; // 1 hour
    const uploadUrl = await this.s3Storage.getPresignedUploadUrl(
      s3Bucket,
      s3Key,
      {
        contentType,
        metadata: {
          userId,
          originalFilename: filename,
          uploadJobId: uploadJob.id,
          fileSize: fileSize?.toString() || "",
        },
        expiresIn,
      }
    );

    // Update job with S3 info
    await this.uploadJobRepository.update(uploadJob.id, {
      s3Bucket,
      s3Key,
      status: "uploading",
    });

    return {
      jobId: uploadJob.id,
      uploadUrl,
      s3Key,
      s3Bucket,
      expiresIn,
    };
  }
}

