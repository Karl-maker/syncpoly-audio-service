import { CustomerRepository } from "../../infrastructure/database/repositories/customer.repository";
import { Customer } from "../../domain/entities/customer";

export interface CreateCustomerUseCaseParams {
  userId: string;
  email: string;
  name: string;
  customerId?: string;
  customerProvider?: 'stripe';
  customerSubscriptionId?: string;
}

export class CreateCustomerUseCase {
  constructor(
    private customerRepository: CustomerRepository
  ) {}

  async execute(params: CreateCustomerUseCaseParams): Promise<Customer> {
    const { userId, email, name, customerId, customerProvider, customerSubscriptionId } = params;

    // Check if customer already exists for this user
    const existingCustomer = await this.customerRepository.findOneByUserId(userId);
    if (existingCustomer) {
      throw new Error("Customer already exists for this user");
    }

    // Create new customer
    const customer = await this.customerRepository.create({
      userId,
      email,
      name,
      customerId,
      customerProvider,
      customerSubscriptionId,
    } as Omit<Customer, "id" | "createdAt" | "updatedAt">);

    return customer;
  }
}

