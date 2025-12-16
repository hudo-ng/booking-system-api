import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { getDistanceFromLatLonInKm } from "../utils/distance";
import axios, { all } from "axios";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();

// GET /work-shifts/full/clock-history?month=9&year=2025&userId=123
export const getWorkShiftsFull = async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ message: " userId are required" });
    }

    const shifts = await prisma.workShift.findMany({
      where: {
        userId: String(userId),
      },
      orderBy: { clockIn: "asc" },
    });
    res.json({ shifts });
  } catch (error) {
    console.error("Error fetching clock history:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
// GET /work-shifts/clock-history?month=9&year=2025&userId=123
export const getWorkShiftsByMonth = async (req: Request, res: Response) => {
  try {
    const { month, year, userId } = req.query;

    if (!month || !year || !userId) {
      return res
        .status(400)
        .json({ message: "month, year, and userId are required" });
    }

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);

    const shifts = await prisma.workShift.findMany({
      where: {
        userId: String(userId),
        clockIn: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { clockIn: "asc" },
    });

    res.json({ shifts });
  } catch (error) {
    console.error("Error fetching clock history:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ✅ Clock In
export const clockIn = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  const { latitude, longitude } = req.body;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized: userId missing" });
  }

  if (!latitude || !longitude) {
    return res.status(400).json({ message: "Location required" });
  }

  // ✅ Check distance from allowed locations
  const distanceA = getDistanceFromLatLonInKm(
    latitude,
    longitude,
    51.03869,
    -114.060243
  );
  const distanceB = getDistanceFromLatLonInKm(
    latitude,
    longitude,
    29.51305,
    -98.551407
  );

  if (distanceB > 2 && distanceA > 2) {
    return res.status(403).json({
      message: "You are not within 2km of the expected location",
    });
  }

  // ✅ Check active shift
  const activeShift = await prisma.workShift.findFirst({
    where: { userId, clockOut: null },
    orderBy: { clockIn: "desc" },
  });

  if (activeShift) {
    const lastClockIn = dayjs(activeShift.clockIn).tz("America/Chicago");
    const nowChicago = dayjs().tz("America/Chicago");

    if (lastClockIn.isSame(nowChicago, "day")) {
      return res.status(400).json({ message: "Already clocked in today" });
    }
  }

  // ✅ Get today's Chicago date
  const nowChicago = dayjs().tz("America/Chicago");
  const dayOfWeek = nowChicago.day();

  const schedule = await prisma.workSchedule.findFirst({
    where: { userId, dayOfWeek },
  });

  if (!schedule) {
    return res
      .status(403)
      .json({ message: "No work schedule found for today" });
  }

  // ✅ Convert schedule times (UTC in DB) → Chicago time
  let startTime = dayjs(schedule.startTime).tz("America/Chicago");
  let endTime = dayjs(schedule.endTime).tz("America/Chicago");

  // ✅ Apply today's date to both times
  startTime = startTime
    .year(nowChicago.year())
    .month(nowChicago.month())
    .date(nowChicago.date());

  endTime = endTime
    .year(nowChicago.year())
    .month(nowChicago.month())
    .date(nowChicago.date());

  // ✅ Off-day case (if start === end)
  if (startTime.valueOf() === endTime.valueOf()) {
    return res.status(403).json({
      message: "Clock-in not allowed — no scheduled shift for today.",
    });
  }

  // ✅ Handle overnight shifts
  if (endTime.isBefore(startTime)) {
    endTime = endTime.add(1, "day");
  }

  // ✅ Compare now to schedule window
  // if (nowChicago.isBefore(startTime) || nowChicago.isAfter(endTime)) {
  //   return res.status(403).json({
  //     message: `You can only clock in between ${startTime.format(
  //       "h:mm A"
  //     )} and ${endTime.format("h:mm A")} Chicago time.`,
  //   });
  // }

  // ✅ Clock in
  const shift = await prisma.workShift.create({
    data: {
      userId,
      clockIn: nowChicago.toDate(), // ✅ store Chicago-adjusted time
    },
  });

  return res.json({
    message: "Clocked in successfully",
    shift,
  });
};

export const clockOut = async (req: Request, res: Response) => {
  const { id: userId } = (req as any).user;

  // Optional clock-out time from payload
  const { clockOutAt } = req.body as {
    clockOutAt?: string; // ISO string expected
  };

  // -----------------------------
  // FIND ACTIVE SHIFT
  // -----------------------------
  const activeShift = await prisma.workShift.findFirst({
    where: {
      userId,
      clockOut: null,
    },
    orderBy: { clockIn: "desc" },
  });

  if (!activeShift) {
    return res.status(400).json({ message: "Not clocked in" });
  }

  // -----------------------------
  // RESOLVE CLOCK-OUT TIME
  // -----------------------------
  const now = new Date();
  const resolvedClockOut = clockOutAt ? new Date(clockOutAt) : now;

  if (isNaN(resolvedClockOut.getTime())) {
    return res.status(400).json({ message: "Invalid clockOutAt value" });
  }

  const clockInDate = new Date(activeShift.clockIn);

  // -----------------------------
  // VALIDATIONS
  // -----------------------------

  // ❌ Cannot clock out before clock-in
  if (resolvedClockOut <= clockInDate) {
    return res
      .status(400)
      .json({ message: "Clock-out time must be after clock-in time" });
  }

  // ❌ Cannot clock out too far in the future (anti-abuse)
  const FUTURE_LIMIT_MIN = 10;
  if (resolvedClockOut.getTime() > now.getTime() + FUTURE_LIMIT_MIN * 60000) {
    return res
      .status(400)
      .json({ message: "Clock-out time is too far in the future" });
  }

  // ❌ Shift too old (existing rule)
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(now.getDate() - 2);

  if (clockInDate < twoDaysAgo) {
    return res.status(400).json({
      message: "Active shift is older than 2 days, cannot clock out",
    });
  }

  // -----------------------------
  // CLOCK OUT
  // -----------------------------
  const shift = await prisma.workShift.update({
    where: { id: activeShift.id },
    data: {
      clockOut: resolvedClockOut,
    },
  });

  res.json({
    message: "Clocked out successfully",
    shift,
  });
};

// ✅ Extend Shift (Owner only)
export const extendShift = async (req: Request, res: Response) => {
  const { userId, date, newEndTime } = req.body;
  const currentUser = await prisma.user.findUnique({
    where: { id: (req as any).user.userId },
    select: { isOwner: true },
  });

  if (!currentUser?.isOwner) {
    return res.status(403).json({ message: "Only owner can extend shifts" });
  }

  try {
    const override = await prisma.workOverride.upsert({
      where: {
        userId_date: {
          userId: userId,
          date: new Date(date),
        },
      },
      update: {
        newEndTime: new Date(newEndTime),
      },
      create: {
        userId: userId,
        date: new Date(date),
        newEndTime: new Date(newEndTime),
      },
    });

    res.json({ message: "Shift extended", override });
  } catch (error) {
    console.error("Error extending shift:", error);
    res.status(500).json({ message: "Error extending shift" });
  }
};

// ✅ Edit ClockIn / ClockOut (Owner only)
export const editClockInAndClockOutTimeByShiftId = async (
  req: Request,
  res: Response
) => {
  const { shiftId, newClockIn, newClockOut } = req.body;
  const currentUser = await prisma.user.findUnique({
    where: { id: (req as any).user.userId },
    select: { isOwner: true },
  });

  if (!currentUser?.isOwner) {
    return res.status(403).json({ message: "Only owner can edit shifts" });
  }

  try {
    const updatedShift = await prisma.workShift.update({
      where: { id: shiftId },
      data: {
        clockIn: newClockIn ? new Date(newClockIn) : undefined,
        clockOut: newClockOut ? new Date(newClockOut) : undefined,
      },
    });

    res.json({ message: "Shift updated", shift: updatedShift });
  } catch (error) {
    console.error("Error editing shift:", error);
    res.status(500).json({ message: "Error editing shift" });
  }
};

// ✅ Get Work Shifts (with auto-filled clockOut)
export const getWorkShifts = async (req: Request, res: Response) => {
  const shifts = await prisma.workShift.findMany({
    include: { user: true },
    orderBy: { clockIn: "desc" },
  });

  const result = await Promise.all(
    shifts.map(async (shift) => {
      if (shift.clockOut) return shift;

      const userId = shift.userId;
      const shiftDate = new Date(shift.clockIn);
      const dayOfWeek = shiftDate.getDay();

      // Get base schedule
      const schedule = await prisma.workSchedule.findFirst({
        where: { userId, dayOfWeek },
      });

      // Get override if exists
      const override = await prisma.workOverride.findFirst({
        where: { userId, date: new Date(shiftDate.toDateString()) },
      });

      let endTime: Date | null = null;
      if (override) {
        endTime = override.newEndTime;
      } else if (schedule) {
        // combine shift date with schedule.endTime's time
        const dateOnly = new Date(shiftDate.toDateString());
        const [h, m, s] = schedule.endTime
          .toISOString()
          .split("T")[1]
          .split(":");
        endTime = new Date(dateOnly);
        endTime.setHours(Number(h), Number(m), Number(s));
      }

      return {
        ...shift,
        clockOut: endTime, // fallback if original clockOut was null
      };
    })
  );

  res.json(result);
};

// ✅ Get weekly schedule(s) based on logged-in user
export const getWorkSchedule = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Query the current user
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Owner → get all users' schedules
    if (currentUser.isOwner) {
      // Get all users
      const allUsers = await prisma.user.findMany({
        select: { id: true, name: true, email: true },
      });

      // Collect all schedules for all users
      let allSchedules: (typeof prisma.workSchedule.findMany extends Promise<
        infer U
      >
        ? U
        : any)[] = [];

      for (const user of allUsers) {
        let userSchedules = await prisma.workSchedule.findMany({
          where: { userId: user.id },
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { dayOfWeek: "asc" },
        });

        // If no schedule found → create default 7 entries
        if (userSchedules.length === 0) {
          const defaultSchedules = Array.from({ length: 7 }, (_, idx) => ({
            userId: user.id,
            dayOfWeek: idx,
            startTime: dayjs().hour(9).minute(0).second(0).toDate(),
            endTime: dayjs().hour(9).minute(0).second(0).toDate(),
          }));

          userSchedules = await prisma.$transaction(
            defaultSchedules.map((s) =>
              prisma.workSchedule.create({
                data: s,
                include: {
                  user: { select: { id: true, name: true, email: true } },
                },
              })
            )
          );
        }

        allSchedules.push(...userSchedules);
      }

      return res.json(allSchedules);
    }

    // Normal user → get only their schedule
    const schedule = await prisma.workSchedule.findMany({
      where: { userId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { dayOfWeek: "asc" },
    });

    res.json(schedule);
  } catch (error) {
    console.error("Error fetching schedule:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ✅ Set (replace) weekly schedule for a user
export const setWorkScheduleByUserId = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  const { id, schedules } = req.body;
  // schedules = [{ dayOfWeek: number, startTime: string, endTime: string }, ...]
  if (!id) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  // Query the current user
  const currentUserInToken = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (currentUserInToken?.isOwner === false) {
    return res.status(403).json({ message: "Only owner can set schedules" });
  }
  // Query the current user
  const currentUser = await prisma.user.findUnique({
    where: { id: id },
  });
  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  if (!id || !Array.isArray(schedules)) {
    return res
      .status(400)
      .json({ message: "userId and schedules are required" });
  }

  // Remove old schedule first
  await prisma.workSchedule.deleteMany({
    where: { userId: id },
  });

  // Create new schedule
  const newSchedules = await prisma.$transaction(
    schedules.map((s) =>
      prisma.workSchedule.create({
        data: {
          userId: id,
          dayOfWeek: s.dayOfWeek,
          startTime: new Date(s.startTime),
          endTime: new Date(s.endTime),
        },
      })
    )
  );

  res.json({ message: "Schedule updated", schedules: newSchedules });
};

export const getPiercingReport = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Missing startDate or endDate" });
    }

    const allData: any[] = [];

    // Parse start and end dates safely (avoid timezone shifts)
    const [startY, startM, startD] = startDate.split("-").map(Number);
    const [endY, endM, endD] = endDate.split("-").map(Number);

    const start = new Date(startY, startM - 1, startD); // month is 0-indexed
    const end = new Date(endY, endM - 1, endD);
    const current = new Date(start);

    while (current <= end) {
      // Format as MMDDYYYY
      const formattedDate = `${(current.getMonth() + 1)
        .toString()
        .padStart(2, "0")}${current
        .getDate()
        .toString()
        .padStart(2, "0")}${current.getFullYear()}`;

      // Fetch data for this date
      const response = await axios.post(
        "https://hyperinkersform.com/api/fetching",
        {
          endDate: formattedDate,
        }
      );

      if (response.data?.data) {
        allData.push(...response.data.data);
      }

      // Move to next day
      current.setDate(current.getDate() + 1);
    }

    // Filter only piercing items
    // const piercingData = allData.filter(
    //   (item) =>
    //     item.color === "piercing" &&
    //     ["done", "paid"].includes(item?.status?.toLowerCase())
    // );
    const piercingData = allData.filter((item) => item.color === "piercing");

    return res.json({ data: piercingData });
  } catch (error: any) {
    console.error("Error fetching piercing report:", error.message);
    return res.status(500).json({ message: "Failed to fetch report" });
  }
};

export const getTattooReport = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Missing startDate or endDate" });
    }

    const allData: any[] = [];

    // Parse start and end dates safely (avoid timezone shifts)
    const [startY, startM, startD] = startDate.split("-").map(Number);
    const [endY, endM, endD] = endDate.split("-").map(Number);

    const start = new Date(startY, startM - 1, startD); // month is 0-indexed
    const end = new Date(endY, endM - 1, endD);
    const current = new Date(start);

    while (current <= end) {
      // Format as MMDDYYYY
      const formattedDate = `${(current.getMonth() + 1)
        .toString()
        .padStart(2, "0")}${current
        .getDate()
        .toString()
        .padStart(2, "0")}${current.getFullYear()}`;

      // Fetch data for this date
      const response = await axios.post(
        "https://hyperinkersform.com/api/fetching",
        {
          endDate: formattedDate,
        }
      );

      if (response.data?.data) {
        allData.push(...response.data.data);
      }

      // Move to next day
      current.setDate(current.getDate() + 1);
    }

    // Filter only piercing items
    // const piercingData = allData.filter(
    //   (item) =>
    //     item.color === "piercing" &&
    //     ["done", "paid"].includes(item?.status?.toLowerCase())
    // );
    const piercingData = allData.filter((item) => item.color !== "piercing");

    return res.json({ data: piercingData });
  } catch (error: any) {
    console.error("Error fetching piercing report:", error.message);
    return res.status(500).json({ message: "Failed to fetch report" });
  }
};

export const getPaymentReport = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, artist } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Missing startDate or endDate" });
    }

    const allData: any[] = [];

    // Parse start and end dates safely (avoid timezone shifts)
    const [startY, startM, startD] = startDate.split("-").map(Number);
    const [endY, endM, endD] = endDate.split("-").map(Number);

    const start = new Date(startY, startM - 1, startD); // month is 0-indexed
    const end = new Date(endY, endM - 1, endD);
    const current = new Date(start);

    while (current <= end) {
      // Format as MMDDYYYY
      const formattedDate = `${(current.getMonth() + 1)
        .toString()
        .padStart(2, "0")}${current
        .getDate()
        .toString()
        .padStart(2, "0")}${current.getFullYear()}`;
      // Fetch data for this date
      const response = await axios.post(
        "https://hyperinkersform.com/api/fetching",
        {
          endDate: formattedDate,
        }
      );

      if (response.data?.data) {
        allData.push(...response.data.data);
      }

      // Move to next day
      current.setDate(current.getDate() + 1);
    }
    // Filter only piercing items
    let piercingData = allData.filter(
      (item) =>
        item?.status?.toLowerCase() === "paid" ||
        item?.status?.toLowerCase() === "done"
    );
    if (artist !== "All") {
      piercingData = piercingData?.filter(
        (k) => k?.artist?.toLowerCase() === artist?.toLowerCase()
      );
    }

    return res.json({ data: piercingData });
  } catch (error: any) {
    console.error("Error fetching piercing report:", error.message);
    return res.status(500).json({ message: "Failed to fetch report" });
  }
};
