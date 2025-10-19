import { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();
const ZONE = "America/Chicago";

export const setTimeOff = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const { date, reason } = req.body;

  const localStart = dayjs.tz(date, "YYYY-MM-DD", ZONE).startOf("day");
  const storeUtc = localStart.toDate();

  const start = localStart.utc();
  const end = localStart.add(1, "day").utc();

  const exists = await prisma.timeOff.findFirst({
    where: {
      employeeId: userId,
      date: { gte: start.toDate(), lt: end.toDate() },
    },
  });
  if (exists) return res.status(409).json({ message: "Already off that day" });

  const entry = await prisma.timeOff.create({
    data: { employeeId: userId, date: storeUtc, reason },
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
