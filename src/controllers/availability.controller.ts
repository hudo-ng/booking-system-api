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

  //get weekday's hours
  const weekday = target.day();
  const hours = await prisma.workingHours.findFirst({
    where: { employeeId, weekday },
  });
  if (!hours) res.json([]);

  //build one hour slots
  const slots: string[] = [];
  let cursor = target.hour(Number(hours?.startTime.split(":")[0])).minute(0);
  const endHour = Number(hours?.endTime.split(":")[0]);
  while (cursor.hour() < endHour) {
    slots.push(cursor.toISOString());
    cursor = cursor.add(1, "hour");
  }

  // time off exclusion
  const isOff = await prisma.timeOff.findFirst({
    where: { employeeId, date: target.toDate() },
  });
  if (isOff) return res.json([]);

  // accepted appointments exclusion
  const appts = await prisma.appointment.findMany({
    where: {
      employeeId,
      status: "accepted",
      startTime: { gte: target.startOf("day").toDate() },
      endTime: { lte: target.endOf("day").toDate() },
    },
  });

  const occupied = new Set<string>();
  for (let a of appts) {
    let current = dayjs(a.startTime);
    while (current.isBefore(a.endTime)) {
      occupied.add(current.toISOString());
      current = current.add(1, "hour");
    }
  }

  // free slots
  const freeSlots = slots.filter((s) => !occupied.has(s));
  res.json(freeSlots);
};
