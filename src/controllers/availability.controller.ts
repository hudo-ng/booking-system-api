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
  const startOfDay = target.startOf("day").toDate();
  const endOfDay = target.endOf("day").toDate();

  // Check for time off
  const isOff = await prisma.timeOff.findFirst({
    where: { employeeId, date: startOfDay },
  });
  if (isOff) return res.json([]);

  // Get working hours for the weekday
  const hours = await prisma.workingHours.findMany({
    where: { employeeId, weekday },
  });
  if (!hours.length) return res.json([]);

  // Fetch accepted appointments
  const appts = await prisma.appointment.findMany({
    where: {
      employeeId,
      status: "accepted",
      startTime: { lt: endOfDay },
      endTime: { gt: startOfDay },
    },
  });

  // Build a set of occupied time slots (1-hour increments)
  const occupied = new Set<string>();
  for (const a of appts) {
    let current = dayjs(a.startTime);
    while (current.isBefore(a.endTime)) {
      occupied.add(current.toISOString());
      current = current.add(1, "hour");
    }
  }

  // Generate available slots with start & end times
  const availableSlots: { start: string; end: string }[] = [];

  for (const interval of hours) {
    const type = interval.type;
    if (type === "custom") {
      if (!interval.startTime || !interval.endTime) continue;
      const start = dayjs(`${date}T${interval.startTime}`);
      const end = dayjs(`${date}T${interval.endTime}`);

      if (start.isValid() && end.isValid() && start.isAfter(dayjs())) {
        if (!occupied.has(start.toISOString())) {
          availableSlots.push({
            start: start.toISOString(),
            end: end.toISOString(),
          });
        }
      }
      continue;
    }

    if (!interval.startTime || !interval.endTime) continue;

    const start = dayjs(`${date}T${interval.startTime}`);
    const end = dayjs(`${date}T${interval.endTime}`);
    if (!start.isValid() || !end.isValid()) continue;

    const step =
      type === "interval"
        ? interval.intervalLength || 60 // default 60 mins
        : 60;

    let current = start;
    while (current.add(1, "minute").isBefore(end)) {
      const slotStart = current;
      const slotEnd = current.add(step, "minute");

      if (
        slotStart.isAfter(dayjs()) &&
        !occupied.has(slotStart.toISOString())
      ) {
        availableSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }

      current = current.add(step, "minute");
    }
  }

  return res.json(availableSlots);
};
