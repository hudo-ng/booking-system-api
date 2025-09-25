import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();

const ZONE = "America/Edmonton";

export const getAvailability = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const { date } = req.query as { date: string };
  const target = dayjs.tz(date, ZONE);
  if (!target.isValid()) {
    return res.status(400).json({ message: "Invalid date" });
  }

  const nowZ = dayjs.tz(undefined, ZONE);
  if (target.startOf("day").isBefore(nowZ.startOf("day"))) {
    return res.status(400).json({ message: "Invalid or past date" });
  }

  const weekday = target.day();
  const startOfDayUtc = target.startOf("day").utc().toDate();
  const endOfDayUtc = target.endOf("day").utc().toDate();

  const isOff = await prisma.timeOff.findFirst({
    where: {
      employeeId,
      date: { gte: startOfDayUtc, lt: endOfDayUtc },
    },
  });
  if (isOff) return res.json([]);

  const hours = await prisma.workingHours.findMany({
    where: { employeeId, weekday },
  });
  if (!hours.length) return res.json([]);

  const appts = await prisma.appointment.findMany({
    where: {
      employeeId,
      status: "accepted",
      startTime: { lt: endOfDayUtc },
      endTime: { gt: startOfDayUtc },
    },
  });

  const occupied = new Set<string>();
  for (const a of appts) {
    let cur = dayjs(a.startTime).utc();
    const end = dayjs(a.endTime).utc();
    while (cur.isBefore(end)) {
      occupied.add(cur.toISOString());
      cur = cur.add(1, "hour");
    }
  }

  const availableSlots: { start: string; end: string }[] = [];

  for (const interval of hours) {
    const { type } = interval;
    if (!interval.startTime || !interval.endTime) continue;

    const baseStart = dayjs.tz(`${date} ${interval.startTime}`, ZONE);
    const baseEnd = dayjs.tz(`${date} ${interval.endTime}`, ZONE);
    if (!baseStart.isValid() || !baseEnd.isValid()) continue;

    if (type === "custom") {
      const slotStartUtc = baseStart.utc();
      const slotEndUtc = baseEnd.utc();

      if (
        slotStartUtc.isAfter(dayjs.utc()) &&
        !occupied.has(slotStartUtc.toISOString())
      ) {
        availableSlots.push({
          start: slotStartUtc.toISOString(), // e.g., 2025-09-25T16:00:00.000Z (9am PT)
          end: slotEndUtc.toISOString(), // e.g., 2025-09-25T19:00:00.000Z (12pm PT)
        });
      }
      continue;
    }

    const step = type === "interval" ? interval.intervalLength || 60 : 60;

    let curLocal = baseStart.clone();
    while (curLocal.isBefore(baseEnd)) {
      const slotStartLocal = curLocal;
      const slotEndLocal = curLocal.add(step, "minute");

      if (slotEndLocal.isAfter(baseEnd)) break;

      const slotStartUtc = slotStartLocal.utc();
      const slotEndUtc = slotEndLocal.utc();

      if (
        slotStartUtc.isAfter(dayjs.utc()) &&
        !occupied.has(slotStartUtc.toISOString())
      ) {
        availableSlots.push({
          start: slotStartUtc.toISOString(),
          end: slotEndUtc.toISOString(),
        });
      }

      curLocal = curLocal.add(step, "minute");
    }
  }

  return res.json(availableSlots);
};
