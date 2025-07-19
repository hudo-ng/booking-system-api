import { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const setTimeOff = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const { date, reason } = req.body;

  const entry = await prisma.timeOff.create({
    data: { employeeId: userId, date: new Date(date), reason },
  });
  res.json(entry);
};

export const getTimeOff = async (req: Request, res: Response) => {
  const userId = (req as any).user;
  const offs = await prisma.timeOff.findMany({
    where: { employeeId: userId },
    orderBy: { date: "desc" },
  });
  res.json(offs);
};
