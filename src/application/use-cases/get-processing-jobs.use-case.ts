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
   * Get the last 10 processing jobs for a user in any status
   * Sorted by createdAt descending (most recent first)
   */
  async execute(params: GetProcessingJobsUseCaseParams): Promise<ProcessingJob[]> {
    const { userId } = params;

    const jobs = await this.processingJobRepository.findRecentJobsByUserId(userId, 10);
    
    return jobs;
  }
}

