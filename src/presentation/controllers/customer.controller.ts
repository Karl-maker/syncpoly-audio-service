import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/jwt.middleware";
import { CreateCustomerUseCase } from "../../application/use-cases/create-customer.use-case";
import { GetCustomerUseCase } from "../../application/use-cases/get-customer.use-case";
import { UpdateCustomerUseCase } from "../../application/use-cases/update-customer.use-case";
import { DeactivateCustomerUseCase } from "../../application/use-cases/deactivate-customer.use-case";
import {
  CreateCustomerRequest,
  UpdateCustomerRequest,
  DeactivateCustomerRequest,
  CustomerResponse,
  toCustomerResponse,
} from "../dto/customer.dto";

export class CustomerController {
  constructor(
    private createCustomerUseCase: CreateCustomerUseCase,
    private getCustomerUseCase: GetCustomerUseCase,
    private updateCustomerUseCase: UpdateCustomerUseCase,
    private deactivateCustomerUseCase: DeactivateCustomerUseCase
  ) {}

  async createCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { email, name, customerId, customerProvider, customerSubscriptionId } = req.body as CreateCustomerRequest;

      if (!email || !name) {
        res.status(400).json({ error: "Email and name are required" });
        return;
      }

      const customer = await this.createCustomerUseCase.execute({
        userId: req.user.userId,
        email,
        name,
        customerId,
        customerProvider,
        customerSubscriptionId,
      });

      const response: CustomerResponse = toCustomerResponse(customer);
      res.status(201).json(response);
    } catch (error: any) {
      if (error.message?.includes("already exists")) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to create customer" });
    }
  }

  async getCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const customer = await this.getCustomerUseCase.execute({
        userId: req.user.userId,
      });

      if (!customer) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }

      const response: CustomerResponse = toCustomerResponse(customer);
      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get customer" });
    }
  }

  async updateCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { email, name, customerId, customerProvider, customerSubscriptionId } = req.body as UpdateCustomerRequest;

      const customer = await this.updateCustomerUseCase.execute({
        userId: req.user.userId,
        email,
        name,
        customerId,
        customerProvider,
        customerSubscriptionId,
      });

      const response: CustomerResponse = toCustomerResponse(customer);
      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("Cannot update")) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to update customer" });
    }
  }

  async deactivateCustomer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { reason } = req.body as DeactivateCustomerRequest;

      if (!reason) {
        res.status(400).json({ error: "Reason is required" });
        return;
      }

      const customer = await this.deactivateCustomerUseCase.execute({
        userId: req.user.userId,
        reason,
      });

      const response: CustomerResponse = toCustomerResponse(customer);
      res.status(200).json(response);
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.message?.includes("already deactivated")) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error.message || "Failed to deactivate customer" });
    }
  }
}

