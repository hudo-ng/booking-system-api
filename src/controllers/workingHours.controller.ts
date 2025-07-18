import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const setWorkingHours = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const { weekday, startTime, endTime } = req.body;

  const entry = await prisma.workingHours.upsert({
    where: { employeeId_weekday: { employeeId: userId, weekday } },
    update: { startTime, endTime },
    create: {
      employeeId: userId,
      weekday,
      startTime,
      endTime,
    },
  });
  res.json(entry);
};

export const getTimeOff = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const offs = await prisma.timeOff.findMany({
    where: { employeeId: userId },
    orderBy: { date: "desc" },
  });

  res.json(offs);
};
