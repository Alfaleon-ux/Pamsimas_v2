import type { Request, Response, NextFunction } from "express";
import { auth } from "../auth/index.js";
import { fromNodeHeaders } from "better-auth/node";

// Extend Express Request to include user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        username?: string | null;
        role: string;
        image?: string | null;
      };
      session?: {
        id: string;
        userId: string;
        token: string;
        expiresAt: Date;
      };
    }
  }
}

/**
 * Middleware: Require authenticated session.
 * Attaches `req.user` and `req.session` on success.
 * Returns 401 if no valid session.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!result || !result.user) {
      res.status(401).json({ error: "Unauthorized — please log in" });
      return;
    }

    req.user = result.user as Express.Request["user"];
    req.session = result.session as Express.Request["session"];
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

/**
 * Middleware factory: Require a specific role.
 * Must be used AFTER `requireAuth`.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: `Forbidden — requires role: ${roles.join(" or ")}`,
      });
      return;
    }

    next();
  };
}
