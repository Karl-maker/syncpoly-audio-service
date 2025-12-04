import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { ProcessingJob } from "../../domain/entities/processing-job";

export interface GetProcessingJobsUseCaseParams {
  userId: string;
}

export class GetProcessingJobsUseCase {
  constructor(
    private processingJobRepository: ProcessingJobRepository
  ) {}

  /**
   * Get all processing jobs for a user that are currently processing
   * (status: "pending" or "processing") and were created or started in the past day
   */
  async execute(params: GetProcessingJobsUseCaseParams): Promise<ProcessingJob[]> {
    const { userId } = params;

    const jobs = await this.processingJobRepository.findProcessingJobsInPastDay(userId);
    
    return jobs;
  }
}

