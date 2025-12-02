import { Breakdown } from "../../domain/entities/breakdown";
import { BreakdownRepository } from "../../infrastructure/database/repositories/breakdown.repository";

export interface GetBreakdownUseCaseParams {
  breakdownId: string;
  userId: string;
}

export class GetBreakdownUseCase {
  constructor(private breakdownRepository: BreakdownRepository) {}

  async execute(params: GetBreakdownUseCaseParams): Promise<Breakdown> {
    const { breakdownId, userId } = params;

    const breakdown = await this.breakdownRepository.findById(breakdownId);
    if (!breakdown) {
      throw new Error(`Breakdown with ID ${breakdownId} not found`);
    }
    if (breakdown.userId !== userId) {
      throw new Error("Unauthorized: Breakdown does not belong to user");
    }

    return breakdown;
  }
}


