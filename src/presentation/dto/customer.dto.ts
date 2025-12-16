import { Customer } from "../../domain/entities/customer";

export interface CreateCustomerRequest {
  email: string;
  name: string;
  customerId?: string;
  customerProvider?: 'stripe';
  customerSubscriptionId?: string;
}

export interface UpdateCustomerRequest {
  email?: string;
  name?: string;
  customerId?: string;
  customerProvider?: 'stripe';
  customerSubscriptionId?: string;
  userCategory?: string;
  userIntent?: string;
}

export interface DeactivateCustomerRequest {
  reason: string;
}

export interface CustomerResponse {
  id: string;
  userId: string;
  email: string;
  name: string;
  customerId?: string;
  customerProvider?: 'stripe';
  customerSubscriptionId?: string;
  userCategory: string;
  userIntent: string;
  deactivatedAt?: Date;
  deactivatedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function toCustomerResponse(customer: Customer): CustomerResponse {
  return {
    id: customer.id,
    userId: customer.userId,
    email: customer.email,
    name: customer.name,
    customerId: customer.customerId,
    customerProvider: customer.customerProvider,
    customerSubscriptionId: customer.customerSubscriptionId,
    userCategory: customer.userCategory,
    userIntent: customer.userIntent,
    deactivatedAt: customer.deactivatedAt,
    deactivatedReason: customer.deactivatedReason,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}




