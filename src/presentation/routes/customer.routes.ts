import { Router } from "express";
import { CustomerController } from "../controllers/customer.controller";
import { jwtMiddleware } from "../middleware/jwt.middleware";

export function createCustomerRoutes(
  customerController: CustomerController
): Router {
  const router = Router();

  // All routes require authentication
  router.use(jwtMiddleware);

  // Get current customer (based on auth token userId)
  router.get("/", (req, res) => customerController.getCustomer(req as any, res));

  // Create customer
  router.post("/", (req, res) => customerController.createCustomer(req as any, res));

  // Update customer
  router.patch("/", (req, res) => customerController.updateCustomer(req as any, res));

  // Deactivate customer
  router.post("/deactivate", (req, res) => customerController.deactivateCustomer(req as any, res));

  return router;
}




