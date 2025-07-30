import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

const prisma = new PrismaClient();

export const getAvailability = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const { date } = req.query as { date: string };

  const target = dayjs(date);
  if (!target.isValid() || target.isBefore(dayjs(), "day")) {
    return res.status(400).json({ message: "Invalid or past date" });
  }

  const weekday = target.day();

  // time off exclusion
  const startOfDay = target.startOf("day").toDate();
  const endOfDay = target.endOf("day").toDate();

  const exists = await prisma.timeOff.findFirst({
    where: {
      employeeId,
      date: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  if (exists) return res.json([]);

  // Get all intervals for the weekday
  const hours = await prisma.workingHours.findMany({
    where: { employeeId, weekday },
  });

  if (!hours.length) return res.json([]);

  // Get accepted appointments on this day
  const appts = await prisma.appointment.findMany({
    where: {
      employeeId,
      status: "accepted",
      startTime: { lt: target.endOf("day").toDate() },
      endTime: { gt: target.startOf("day").toDate() },
    },
  });

  const occupied = new Set<string>();
  for (const a of appts) {
    let current = dayjs(a.startTime);
    while (current.isBefore(a.endTime)) {
      occupied.add(current.toISOString());
      current = current.add(1, "hour");
    }
  }

  const slots: string[] = [];
  // free slots
  const freeSlots = slots.filter((s) => !occupied.has(s));
  return res.json(freeSlots);
};
