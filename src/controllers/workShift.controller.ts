import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { getDistanceFromLatLonInKm } from "../utils/distance";

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
    console.log("Fetching clock history for: ", userId);
    console.log("Month:", month);
    console.log("Year:", year);
    console.log("UserId:", userId);
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

  // ✅ Check distance
  // const distance = getDistanceFromLatLonInKm(
  //   latitude,
  //   longitude,
  //   51.03869,
  //   -114.060243
  // );
  const distance = getDistanceFromLatLonInKm(
    latitude,
    longitude,
    29.51305,
    -98.551407
  );
  if (distance > 2) {
    return res
      .status(403)
      .json({ message: "You are not within 2km of the expected location" });
  }

  const activeShift = await prisma.workShift.findFirst({
    where: { userId, clockOut: null },
    orderBy: { clockIn: "desc" }, // ✅ get the latest one
  });

  if (activeShift) {
    const clockInDate = new Date(activeShift.clockIn);
    const today = new Date();

    const isSameDay =
      clockInDate.getFullYear() === today.getFullYear() &&
      clockInDate.getMonth() === today.getMonth() &&
      clockInDate.getDate() === today.getDate();

    if (isSameDay) {
      return res.status(400).json({ message: "Already clocked in today" });
    }
    // else: old shift without clockOut → let them start a new one
  }

  const shift = await prisma.workShift.create({
    data: { userId, clockIn: new Date() },
  });

  res.json({ message: "Clocked in successfully", shift });
};

// ✅ Clock Out
export const clockOut = async (req: Request, res: Response) => {
  const { id: userId } = (req as any).user;

  // Find the latest active shift (not clocked out yet)
  const activeShift = await prisma.workShift.findFirst({
    where: { userId, clockOut: null },
    orderBy: { clockIn: "desc" }, // ✅ latest shift
  });

  if (!activeShift) {
    return res.status(400).json({ message: "Not clocked in" });
  }

  // ✅ Check if clockIn is today
  const today = new Date();
  const clockInDate = new Date(activeShift.clockIn);

  const isSameDay =
    clockInDate.getFullYear() === today.getFullYear() &&
    clockInDate.getMonth() === today.getMonth() &&
    clockInDate.getDate() === today.getDate();

  if (!isSameDay) {
    return res.status(400).json({ message: "Active shift is not from today" });
  }

  // ✅ Clock out
  const shift = await prisma.workShift.update({
    where: { id: activeShift.id },
    data: { clockOut: new Date() },
  });

  res.json({ message: "Clocked out successfully", shift });
};

// ✅ Extend Shift (Owner only)
export const extendShift = async (req: Request, res: Response) => {
  const { userId, date, newEndTime } = req.body;
  const { isOwner } = (req as any).user;

  if (!isOwner) {
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
  const { isOwner } = (req as any).user;

  if (!isOwner) {
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
