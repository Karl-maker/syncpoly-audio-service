import { CustomerRepository } from "../../infrastructure/database/repositories/customer.repository";
import { Customer } from "../../domain/entities/customer";

export interface UpdateCustomerUseCaseParams {
  userId: string;
  email?: string;
  name?: string;
  customerId?: string;
  customerProvider?: 'stripe';
  customerSubscriptionId?: string;
  userCategory?: string;
  userIntent?: string;
}

export class UpdateCustomerUseCase {
  constructor(
    private customerRepository: CustomerRepository
  ) {}

  async execute(params: UpdateCustomerUseCaseParams): Promise<Customer> {
    const { userId, email, name, customerId, customerProvider, customerSubscriptionId, userCategory, userIntent } = params;

    // Get existing customer
    const existingCustomer = await this.customerRepository.findOneByUserId(userId);
    if (!existingCustomer) {
      throw new Error("Customer not found");
    }

    // Validation: Cannot update customerId, customerProvider, or customerSubscriptionId if they already have a value
    const updates: Partial<Customer> = {};

    if (email !== undefined) {
      updates.email = email;
    }

    if (name !== undefined) {
      updates.name = name;
    }

    // Validate customerId - can only be set if it's currently empty
    if (customerId !== undefined) {
      if (existingCustomer.customerId && existingCustomer.customerId !== customerId) {
        throw new Error("Cannot update customerId: it already has a value");
      }
      updates.customerId = customerId;
    }

    // Validate customerProvider - can only be set if it's currently empty
    if (customerProvider !== undefined) {
      if (existingCustomer.customerProvider && existingCustomer.customerProvider !== customerProvider) {
        throw new Error("Cannot update customerProvider: it already has a value");
      }
      updates.customerProvider = customerProvider;
    }

    // Validate customerSubscriptionId - can only be set if it's currently empty
    if (customerSubscriptionId !== undefined) {
      if (existingCustomer.customerSubscriptionId && existingCustomer.customerSubscriptionId !== customerSubscriptionId) {
        throw new Error("Cannot update customerSubscriptionId: it already has a value");
      }
      updates.customerSubscriptionId = customerSubscriptionId;
    }

    // Update userCategory if provided
    if (userCategory !== undefined) {
      updates.userCategory = userCategory;
    }

    // Update userIntent if provided
    if (userIntent !== undefined) {
      updates.userIntent = userIntent;
    }

    // Update customer
    const updatedCustomer = await this.customerRepository.update(existingCustomer.id, updates);
    if (!updatedCustomer) {
      throw new Error("Failed to update customer");
    }

    return updatedCustomer;
  }
}

