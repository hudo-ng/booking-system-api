import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();

const ZONE = "America/Chicago";

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
      status: "APPROVED",
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

  function overlaps(
    aStart: dayjs.Dayjs,
    aEnd: dayjs.Dayjs,
    bStart: dayjs.Dayjs,
    bEnd: dayjs.Dayjs
  ) {
    return aStart.isBefore(bEnd) && bStart.isBefore(aEnd);
  }

  for (const interval of hours) {
    const { type } = interval;
    if (!interval.startTime || !interval.endTime) continue;

    const baseStart = dayjs.tz(`${date} ${interval.startTime}`, ZONE);
    const baseEnd = dayjs.tz(`${date} ${interval.endTime}`, ZONE);
    if (!baseStart.isValid() || !baseEnd.isValid()) continue;

    if (type === "custom") {
      const slotStartUtc = baseStart.utc();
      const slotEndUtc = baseEnd.utc();

      const hasConflict = appts.some((a) => {
        const apptStart = dayjs(a.startTime).utc();
        const apptEnd = dayjs(a.endTime).utc();
        return slotStartUtc.isBefore(apptEnd) && apptStart.isBefore(slotEndUtc);
      });

      if (slotStartUtc.isAfter(dayjs.utc()) && !hasConflict) {
        availableSlots.push({
          start: slotStartUtc.toISOString(),
          end: slotEndUtc.toISOString(),
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

export const getMonthlyAvailability = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const { month } = req.query as { month: string };

  const monthStart = dayjs.tz(`${month}-01`, ZONE).startOf("month");
  if (!monthStart.isValid()) {
    return res.status(400).json({ message: "Invalid month" });
  }

  const monthEnd = monthStart.endOf("month");
  const nowZ = dayjs.tz(undefined, ZONE);

  const [timeOffs, workingHours, appointments] = await Promise.all([
    prisma.timeOff.findMany({
      where: {
        employeeId,
        status: "APPROVED",
        date: {
          gte: monthStart.utc().toDate(),
          lte: monthEnd.utc().toDate(),
        },
      },
    }),
    prisma.workingHours.findMany({ where: { employeeId } }),
    prisma.appointment.findMany({
      where: {
        employeeId,
        status: "accepted",
        startTime: { lt: monthEnd.utc().toDate() },
        endTime: { gt: monthStart.utc().toDate() },
      },
    }),
  ]);

  const results: {
    date: string;
    totalSlots: number;
    availableSlots: number;
  }[] = [];

  let day = monthStart.clone();

  while (day.isSameOrBefore(monthEnd, "day")) {
    const dateStr = day.format("YYYY-MM-DD");

    if (day.startOf("day").isBefore(nowZ.startOf("day"))) {
      results.push({ date: dateStr, totalSlots: 0, availableSlots: 0 });
      day = day.add(1, "day");
      continue;
    }

    const weekday = day.day();
    const dayStartUtc = day.startOf("day").utc().toDate();
    const dayEndUtc = day.endOf("day").utc().toDate();

    const isOff = timeOffs.some(
      (t) => t.date >= dayStartUtc && t.date < dayEndUtc
    );

    if (isOff) {
      results.push({ date: dateStr, totalSlots: 0, availableSlots: 0 });
      day = day.add(1, "day");
      continue;
    }

    const hoursForDay = workingHours.filter(
      (w) => w.weekday === weekday
    );

    if (!hoursForDay.length) {
      results.push({ date: dateStr, totalSlots: 0, availableSlots: 0 });
      day = day.add(1, "day");
      continue;
    }

    const apptsForDay = appointments.filter(
      (a) => a.startTime && a.endTime && a.startTime < dayEndUtc && a.endTime > dayStartUtc
    );

    let totalSlots = 0;
    let availableSlots = 0;

    for (const interval of hoursForDay) {
      if (!interval.startTime || !interval.endTime) continue;

      const baseStart = dayjs.tz(
        `${dateStr} ${interval.startTime}`,
        ZONE
      );
      const baseEnd = dayjs.tz(
        `${dateStr} ${interval.endTime}`,
        ZONE
      );

      if (interval.type === "custom") {
        totalSlots++;

        const s = baseStart.utc();
        const e = baseEnd.utc();

        const conflict = apptsForDay.some(
          (a) => s.isBefore(dayjs(a.endTime)) &&
                 dayjs(a.startTime).isBefore(e)
        );

        if (!conflict && s.isAfter(dayjs.utc())) {
          availableSlots++;
        }
        continue;
      }

      const step = interval.intervalLength || 60;
      let cur = baseStart.clone();

      while (cur.add(step, "minute").isSameOrBefore(baseEnd)) {
        totalSlots++;

        const s = cur.utc();
        const e = cur.add(step, "minute").utc();

        const conflict = apptsForDay.some(
          (a) => s.isBefore(dayjs(a.endTime)) &&
                 dayjs(a.startTime).isBefore(e)
        );

        if (!conflict && s.isAfter(dayjs.utc())) {
          availableSlots++;
        }

        cur = cur.add(step, "minute");
      }
    }

    results.push({ date: dateStr, totalSlots, availableSlots });
    day = day.add(1, "day");
  }

  res.json(results);
};
