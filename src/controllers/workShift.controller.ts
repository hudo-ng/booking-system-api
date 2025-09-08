import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

const prisma = new PrismaClient();

// ✅ Clock In
export const clockIn = async (req: Request, res: Response) => {
  const { id: userId } = (req as any).user;

  const activeShift = await prisma.workShift.findFirst({
    where: { userId, clockOut: null },
  });

  if (activeShift) {
    return res.status(400).json({ message: "Already clocked in" });
  }

  const shift = await prisma.workShift.create({
    data: { userId, clockIn: new Date() },
  });

  res.json({ message: "Clocked in successfully", shift });
};

// ✅ Clock Out
export const clockOut = async (req: Request, res: Response) => {
  const { id: userId } = (req as any).user;

  const activeShift = await prisma.workShift.findFirst({
    where: { userId, clockOut: null },
  });

  if (!activeShift) {
    return res.status(400).json({ message: "Not clocked in" });
  }

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
  const { userId, schedules } = req.body;
  // schedules = [{ dayOfWeek: number, startTime: string, endTime: string }, ...]

  if (!userId || !Array.isArray(schedules)) {
    return res
      .status(400)
      .json({ message: "userId and schedules are required" });
  }

  // Remove old schedule first
  await prisma.workSchedule.deleteMany({
    where: { userId },
  });

  // Create new schedule
  const newSchedules = await prisma.$transaction(
    schedules.map((s) =>
      prisma.workSchedule.create({
        data: {
          userId,
          dayOfWeek: s.dayOfWeek,
          startTime: new Date(s.startTime),
          endTime: new Date(s.endTime),
        },
      })
    )
  );

  res.json({ message: "Schedule updated", schedules: newSchedules });
};
