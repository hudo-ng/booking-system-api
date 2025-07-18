import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";

interface AuthPayload {
  userId: string;
  role: string;
}

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer")) return res.sendStatus(401);
  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
    (req as any).user = decoded;
    next();
  } catch {
    res.sendStatus(403);
  }
};

export const authorize = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || !roles.includes(user.role)) return res.sendStatus(403);
    next();
  };
};
