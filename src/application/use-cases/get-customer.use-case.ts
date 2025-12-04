import { CustomerRepository } from "../../infrastructure/database/repositories/customer.repository";
import { Customer } from "../../domain/entities/customer";

export interface GetCustomerUseCaseParams {
  userId: string;
}

export class GetCustomerUseCase {
  constructor(
    private customerRepository: CustomerRepository
  ) {}

  async execute(params: GetCustomerUseCaseParams): Promise<Customer | null> {
    const { userId } = params;

    const customer = await this.customerRepository.findOneByUserId(userId);
    return customer;
  }
}

