import { AudioFileRepository } from "../../infrastructure/database/repositories/audio-file.repository";
import { ProcessingJobRepository } from "../../infrastructure/database/repositories/processing-job.repository";
import { IVectorStore } from "../../domain/interfaces/ivector.store";
import { MemoryUsage } from "../../domain/entities/memory-usage";

export interface GetMemoryUsageUseCaseParams {
  userId: string;
  vectorStore?: IVectorStore;
}

export class GetMemoryUsageUseCase {
  constructor(
    private audioFileRepository: AudioFileRepository,
    private processingJobRepository: ProcessingJobRepository
  ) {}

  async execute(params: GetMemoryUsageUseCaseParams): Promise<MemoryUsage> {
    const { userId } = params;

    // Get total storage from audio files
    const totalStorageBytes = await this.audioFileRepository.getTotalStorageByUserId(
      userId
    );

    // Get audio files count
    const audioFiles = await this.audioFileRepository.findByUserId(userId);
    const totalAudioFiles = audioFiles.length;

    // Get processing jobs to estimate vector store records
    // Note: This is an approximation. In a real implementation, you'd query the vector store directly
    const processingJobs = await this.processingJobRepository.findByUserId(userId);
    const completedJobs = processingJobs.filter((job) => job.status === "completed");
    const totalVectorStoreRecords = completedJobs.length;

    // Estimate vector store memory (rough estimate: ~1KB per record)
    const vectorStoreMemoryBytes = totalVectorStoreRecords * 1024;

    return {
      userId,
      totalAudioFiles,
      totalStorageBytes,
      totalVectorStoreRecords,
      vectorStoreMemoryBytes,
      lastCalculatedAt: new Date(),
    };
  }
}

