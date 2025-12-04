
export interface Customer {
  id: string;
  userId: string;
  email: string;
  name: string;
  customerId?: string;
  customerProvider?: 'stripe';
  customerSubscriptionId?: string;
  createdAt: Date;
  deactivatedAt?: Date;
  deactivatedReason?: string;
  updatedAt: Date;
}




