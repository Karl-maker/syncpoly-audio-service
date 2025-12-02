import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { UploadJob } from "../../domain/entities/upload-job";

export interface GetUploadProgressUseCaseParams {
  jobId: string;
  userId: string;
}

export class GetUploadProgressUseCase {
  constructor(private uploadJobRepository: UploadJobRepository) {}

  async execute(params: GetUploadProgressUseCaseParams): Promise<UploadJob> {
    const { jobId, userId } = params;

    const job = await this.uploadJobRepository.findById(jobId);

    if (!job) {
      throw new Error(`Upload job not found: ${jobId}`);
    }

    if (job.userId !== userId) {
      throw new Error("Unauthorized: Upload job does not belong to user");
    }

    return job;
  }
}


