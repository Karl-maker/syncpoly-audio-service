import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { ProcessingJob } from "../../domain/entities/processing-job";

export interface GetProcessingProgressUseCaseParams {
  jobId: string;
  userId: string;
}

export class GetProcessingProgressUseCase {
  constructor(private processingJobRepository: ProcessingJobRepository) {}

  async execute(params: GetProcessingProgressUseCaseParams): Promise<ProcessingJob> {
    const { jobId, userId } = params;

    const job = await this.processingJobRepository.findById(jobId);

    if (!job) {
      throw new Error(`Processing job with ID ${jobId} not found`);
    }

    if (job.userId !== userId) {
      throw new Error("Unauthorized: Processing job does not belong to user");
    }

    return job;
  }
}



