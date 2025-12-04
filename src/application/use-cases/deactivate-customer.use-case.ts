import { CustomerRepository } from "../../infrastructure/database/repositories/customer.repository";
import { Customer } from "../../domain/entities/customer";

export interface DeactivateCustomerUseCaseParams {
  userId: string;
  reason: string;
}

export class DeactivateCustomerUseCase {
  constructor(
    private customerRepository: CustomerRepository
  ) {}

  async execute(params: DeactivateCustomerUseCaseParams): Promise<Customer> {
    const { userId, reason } = params;

    // Get existing customer
    const existingCustomer = await this.customerRepository.findOneByUserId(userId);
    if (!existingCustomer) {
      throw new Error("Customer not found");
    }

    // Check if already deactivated
    if (existingCustomer.deactivatedAt) {
      throw new Error("Customer is already deactivated");
    }

    // Deactivate customer
    const updatedCustomer = await this.customerRepository.update(existingCustomer.id, {
      deactivatedAt: new Date(),
      deactivatedReason: reason,
    });

    if (!updatedCustomer) {
      throw new Error("Failed to deactivate customer");
    }

    return updatedCustomer;
  }
}

