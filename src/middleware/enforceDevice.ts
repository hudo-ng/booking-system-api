import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { config } from "../config";
import { Request, Response, NextFunction } from "express";

const prisma = new PrismaClient();

export async function enforceDevice(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const h = req.header("Authorization") || "";
  const raw = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!raw) return res.status(401).json({ message: "No token" });

  try {
    const p = jwt.verify(raw, config.jwtSecret) as any;
    const { userId, role, deviceId } = p;

    const isEmployee = (role as any) === "employee";
    if (isEmployee) {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { currentDeviceId: true },
      });
      if (u?.currentDeviceId && deviceId && u.currentDeviceId !== deviceId) {
        return res.status(423).json({
          error: "DEVICE_LOCKED",
          message: "This device is not authorized for this account.",
        });
      }
    }

    (req as any).user = { userId, role, deviceId };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}
