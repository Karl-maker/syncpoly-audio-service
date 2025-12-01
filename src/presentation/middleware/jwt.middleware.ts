import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../../infrastructure/config/app.config";

export interface JWTPayload {
  userId: string;
  name: string;
  email: string;
  [key: string]: any;
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

export function jwtMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: "Authorization header missing" });
      return;
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      res.status(401).json({ error: "Token missing" });
      return;
    }

    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;

    // Verify required fields
    if (!decoded.userId || !decoded.name || !decoded.email) {
      res.status(401).json({ error: "Invalid token payload" });
      return;
    }

    req.user = {
      userId: decoded.userId,
      name: decoded.name,
      email: decoded.email,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired" });
      return;
    }
    res.status(500).json({ error: "Authentication error" });
  }
}

