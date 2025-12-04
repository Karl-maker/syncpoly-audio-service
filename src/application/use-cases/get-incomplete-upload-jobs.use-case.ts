import { UploadJobRepository } from "../../infrastructure/database/repositories/upload-job.repository";
import { UploadJob } from "../../domain/entities/upload-job";

export interface GetIncompleteUploadJobsUseCaseParams {
  userId: string;
  page?: number; // Page number (1-based, default: 1)
  limit?: number; // Number of jobs per page (default: 5)
}

export interface GetIncompleteUploadJobsUseCaseResult {
  jobs: UploadJob[];
  total: number;
  totalPages: number;
  currentPage: number;
}

export class GetIncompleteUploadJobsUseCase {
  constructor(private uploadJobRepository: UploadJobRepository) {}

  async execute(
    params: GetIncompleteUploadJobsUseCaseParams
  ): Promise<GetIncompleteUploadJobsUseCaseResult> {
    const { userId, page = 1, limit = 5 } = params;

    // Validate page and limit
    const validPage = Math.max(1, page);
    const validLimit = Math.max(1, Math.min(100, limit)); // Limit between 1 and 100

    return await this.uploadJobRepository.findIncompleteJobsByUserId(
      userId,
      validPage,
      validLimit
    );
  }
}

