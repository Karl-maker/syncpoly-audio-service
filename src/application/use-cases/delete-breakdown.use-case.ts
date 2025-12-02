import { BreakdownRepository } from "../../infrastructure/database/repositories/breakdown.repository";

export interface DeleteBreakdownUseCaseParams {
  breakdownId: string;
  userId: string;
}

export class DeleteBreakdownUseCase {
  constructor(private breakdownRepository: BreakdownRepository) {}

  async execute(params: DeleteBreakdownUseCaseParams): Promise<void> {
    const { breakdownId, userId } = params;

    const breakdown = await this.breakdownRepository.findById(breakdownId);
    if (!breakdown) {
      throw new Error(`Breakdown with ID ${breakdownId} not found`);
    }
    if (breakdown.userId !== userId) {
      throw new Error("Unauthorized: Breakdown does not belong to user");
    }

    await this.breakdownRepository.delete(breakdownId);
  }
}


