import { PrismaClient } from "@prisma/client";
import { NextFunction, Request, Response } from "express";

const prisma = new PrismaClient();

export async function requireCoursesAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { userId } = (req as any).user as { userId?: string };
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!user.email.toLowerCase().includes("walker")) {
      return res.status(403).json({ message: "Courses feature is not available" });
    }

    next();
  } catch (error) {
    console.error("Failed to verify Courses access", error);
    return res.status(500).json({ message: "Failed to verify feature access" });
  }
}
