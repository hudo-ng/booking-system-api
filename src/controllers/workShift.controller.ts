import { Request, Response } from "express";
import { PrismaClient, SalaryType } from "@prisma/client";
import dayjs from "dayjs";
import { getDistanceFromLatLonInKm } from "../utils/distance";
import axios, { all } from "axios";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { sendPushAsync } from "../services/push";
import isBetween from "dayjs/plugin/isBetween";

dayjs.extend(isBetween);
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
  const { userId } = (req as any).user;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const { latitude, longitude } = req.body;

  // ✅ Location Check (Existing Logic)
  if (latitude && longitude) {
    const distanceA = getDistanceFromLatLonInKm(
      latitude,
      longitude,
      51.03869,
      -114.060243,
    );
    const distanceB = getDistanceFromLatLonInKm(
      latitude,
      longitude,
      29.51305,
      -98.551407,
    );

    if (distanceB > 2 && distanceA > 2) {
      return res.status(403).json({
        message: "You are not within 2km of the expected location",
      });
    }
  }

  // 1. Find an open shift
  const openShift = await prisma.workShift.findFirst({
    where: { userId, clockOut: null },
    orderBy: { clockIn: "desc" },
  });

  if (openShift) {
    const pendingRequest = await prisma.workShiftRequest.findFirst({
      where: { shiftId: openShift.id },
    });

    if (!pendingRequest) {
      const missedDate = dayjs(openShift.clockIn).format("MMM DD, YYYY");
      return res.status(400).json({
        message: `Cannot clock in. You haven't clocked out of your shift on ${missedDate}. Please submit a correction request first.`,
        openShiftId: openShift.id,
        missedDate,
      });
    }

    console.log(
      `User ${userId} has a pending request for shift ${openShift.id}. Allowing new clock-in.`,
    );
  }

  // 2. Schedule Validation & Max Allowed Hours Verification
  const nowChicago = dayjs().tz("America/Chicago");
  const dayOfWeek = nowChicago.day();

  const schedule = await prisma.workSchedule.findFirst({
    where: { userId, dayOfWeek },
  });

  // Default limit is 20 if schedule configuration is missing or property is null
  const maxHourAllow = schedule?.max_hour_allow ?? 20;

  // Define start and end boundaries of today in the local timezone
  const startOfToday = nowChicago.startOf("day").toDate();
  const endOfToday = nowChicago.endOf("day").toDate();

  // Fetch all completed shifts started today to tally worked hours
  const todayShifts = await prisma.workShift.findMany({
    where: {
      userId,
      clockIn: {
        gte: startOfToday,
        lte: endOfToday,
      },
      clockOut: { not: null },
    },
  });

  let hoursWorkedToday = 0;
  todayShifts.forEach((s) => {
    if (s.clockOut) {
      const diffMs =
        new Date(s.clockOut).getTime() - new Date(s.clockIn).getTime();
      hoursWorkedToday += diffMs / (1000 * 60 * 60);
    }
  });

  if (hoursWorkedToday >= maxHourAllow) {
    return res.status(400).json({
      message: `Cannot clock in. You have already reached your maximum allowance of ${maxHourAllow} hours for today.`,
    });
  }

  const hoursRemaining = maxHourAllow - hoursWorkedToday;
  const msRemaining = hoursRemaining * 60 * 60 * 1000;

  // 3. Create New Shift
  const shift = await prisma.workShift.create({
    data: {
      userId,
      clockIn: nowChicago.toDate(),
    },
  });

  // 4. Auto Clock-Out Scheduler (Fire and Forget Background Routine)
  // Only trigger the auto clock-out execution loop if maxHourAllow is strictly less than 18
  if (maxHourAllow < 18) {
    (async () => {
      try {
        setTimeout(async () => {
          try {
            // Check if this specific shift is still active and has not been manually closed
            const currentShiftState = await prisma.workShift.findUnique({
              where: { id: shift.id },
            });

            if (currentShiftState && !currentShiftState.clockOut) {
              const autoClockOutTime = new Date();

              // Execute forced clock-out update
              await prisma.workShift.update({
                where: { id: shift.id },
                data: { clockOut: autoClockOutTime },
              });

              console.log(
                `Shift ${shift.id} has been automatically clocked out due to daily max hour limit reach (${maxHourAllow}h).`,
              );

              // Retrieve registered device notification push targets
              const tokens = (
                await prisma.deviceToken.findMany({
                  where: { userId: userId, enabled: true },
                  select: { token: true },
                })
              ).map((d) => d.token);

              if (tokens.length) {
                await sendPushAsync(tokens, {
                  title: "Shift Auto Clock-Out ⚠️",
                  body: `You have been clocked out automatically because you reached your max limit of ${maxHourAllow} hours today.`,
                  data: { type: "SHIFT_AUTO_CO", status: "auto_clocked_out" },
                });
              }
            }
          } catch (innerErr) {
            console.error(
              "Error executing automated background shift clock-out routine:",
              innerErr,
            );
          }
        }, msRemaining);
      } catch (timeoutSetupErr) {
        console.error(
          "Failed to initialize system auto clock-out scheduler thread:",
          timeoutSetupErr,
        );
      }
    })();
  } else {
    console.log(
      `Skipping background auto-clockout timer rule for user ${userId}. (maxHourAllow: ${maxHourAllow} >= 18)`,
    );
  }

  return res.json({
    message: "Clocked in successfully",
    shift,
    hoursRemaining: parseFloat(hoursRemaining.toFixed(2)),
  });
};

export const createShiftRequest = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const { shiftId, requestedDate, suggestedOut, reason } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const newRequest = await prisma.workShiftRequest.create({
      data: {
        userId,
        shiftId,
        requestedDate: dayjs(requestedDate).toDate(),
        suggestedOut: dayjs(suggestedOut).toDate(),
        reason,
      },
    });

    // ✅ Notify Owners & Admins
    (async () => {
      try {
        const owners = await prisma.user.findMany({
          where: { OR: [{ isOwner: true }, { isAdmin: true }] },
          select: { id: true },
        });

        const tokens = (
          await prisma.deviceToken.findMany({
            where: { userId: { in: owners.map((o) => o.id) }, enabled: true },
            select: { token: true },
          })
        ).map((d) => d.token);

        if (tokens.length) {
          await sendPushAsync(tokens, {
            title: "Shift Correction Request",
            body: `${user?.name || "An artist"} submitted a clock-out correction for ${dayjs(requestedDate).format("MMM D")}.`,
            data: { requestId: newRequest.id, type: "SHIFT_REQUEST" },
          });
        }
      } catch (err) {
        console.error("Push error:", err);
      }
    })();

    return res.json({
      success: true,
      message: "Request submitted to management.",
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// --- 2. GET ALL REQUESTS (Owner Only) ---
export const getAllShiftRequestsByOwner = async (
  req: Request,
  res: Response,
) => {
  // 1. Get userId from request (standard across your controllers)
  const { userId } = (req as any).user as { userId?: string };

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized: No userId found" });
  }

  try {
    // 2. Check if the requester is an Owner
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { isOwner: true }, // Optimization: only select what we need
    });

    if (!currentUser?.isOwner) {
      return res.status(403).json({ error: "Access denied. Owners only." });
    }

    // 3. Fetch all shift requests
    const requests = await prisma.workShiftRequest.findMany({
      orderBy: { createdAt: "desc" },
    });

    // 4. Manual Join: Fetch names for the unique userIds in the requests
    const uniqueUserIds = [...new Set(requests.map((r) => r.userId))];

    const users = await prisma.user.findMany({
      where: { id: { in: uniqueUserIds } },
      select: { id: true, name: true },
    });

    // Map names back to the requests
    const enrichedRequests = requests.map((req) => {
      const user = users.find((u) => u.id === req.userId);
      return {
        ...req,
        userName: user?.name || "Unknown Artist",
      };
    });

    return res.json({
      success: true,
      data: enrichedRequests,
    });
  } catch (error: any) {
    console.error("Error in getAllShiftRequestsByOwner:", error);
    return res.status(500).json({ error: error.message });
  }
};

// --- 3. REVIEW REQUEST (Accept/Decline) ---
export const reviewShiftRequest = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const { requestId, status } = req.body; // status: "approved" or "rejected"

  try {
    // 1. Owner Verification
    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser?.isOwner) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // 2. Find the Request
    const request = await prisma.workShiftRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) return res.status(404).json({ error: "Request not found" });

    // 3. Database Updates
    if (status === "approved" && request.shiftId) {
      await prisma.$transaction([
        prisma.workShift.update({
          where: { id: request.shiftId },
          data: { clockOut: request.suggestedOut },
        }),
        prisma.workShiftRequest.delete({ where: { id: requestId } }),
      ]);
    } else {
      await prisma.workShiftRequest.delete({ where: { id: requestId } });
    }

    // 4. Notify the Artist (Fire and Forget)
    (async () => {
      try {
        const tokens = (
          await prisma.deviceToken.findMany({
            where: { userId: request.userId, enabled: true },
            select: { token: true },
          })
        ).map((d) => d.token);

        if (tokens.length) {
          const title =
            status === "approved"
              ? "Request Approved ✅"
              : "Request Declined ❌";
          const body =
            status === "approved"
              ? "Your clock-out correction was accepted and your hours are updated."
              : "Your clock-out correction request was declined. Please see a manager.";

          await sendPushAsync(tokens, {
            title,
            body,
            data: { type: "SHIFT_UPDATE", status },
          });
        }
      } catch (pushErr) {
        console.error("Push notification error for artist:", pushErr);
      }
    })();

    return res.json({
      success: true,
      message: `Request ${status} successfully.`,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
export const clockOut = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  console.log("clockOut payload with userId:", userId, "and body:", req.body);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.body?.confirmation !== true) {
    return res.status(400).json({ message: "Please download latest version!" });
  }
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ message: "Location required" });
  }

  // ✅ Check distance from allowed locations
  if (latitude && longitude) {
    const distanceA = getDistanceFromLatLonInKm(
      latitude,
      longitude,
      51.03869,
      -114.060243,
    );
    const distanceB = getDistanceFromLatLonInKm(
      latitude,
      longitude,
      29.51305,
      -98.551407,
    );

    if (distanceB > 2 && distanceA > 2) {
      return res.status(403).json({
        message: "You are not within 50m of the expected location",
      });
    }
  }
  // ✅ Safe destructuring
  const { clockOutAt } = (req?.body || {}) as {
    clockOutAt?: string;
  };
  console.log("clockOut payload:", { userId, clockOutAt });

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

  const now = new Date();
  const resolvedClockOut = clockOutAt ? new Date(clockOutAt) : now;

  if (isNaN(resolvedClockOut.getTime())) {
    return res.status(400).json({ message: "Invalid clockOutAt value" });
  }

  const clockInDate = new Date(activeShift.clockIn);

  if (resolvedClockOut <= clockInDate) {
    return res
      .status(400)
      .json({ message: "Clock-out time must be after clock-in time" });
  }

  const FUTURE_LIMIT_MIN = 10;
  if (resolvedClockOut.getTime() > now.getTime() + FUTURE_LIMIT_MIN * 60000) {
    return res
      .status(400)
      .json({ message: "Clock-out time is too far in the future" });
  }

  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(now.getDate() - 2);

  if (clockInDate < twoDaysAgo) {
    return res.status(400).json({
      message: "Active shift is older than 2 days, cannot clock out",
    });
  }

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
  res: Response,
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
    }),
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

    // 1. Fetch current user context
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!currentUser || currentUser.deletedAt !== null) {
      return res.status(404).json({ error: "User not found" });
    }

    const userSelectField = { select: { id: true, name: true, email: true } };

    // --- OWNER FLOW (Bulk Processing Optimized) ---
    if (currentUser.isOwner) {
      // Fetch only active, non-deleted users
      const allUsers = await prisma.user.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });

      // Fetch ALL existing schedules in a single operation
      const flatSchedules = await prisma.workSchedule.findMany({
        where: { userId: { in: allUsers.map((u) => u.id) } },
        include: { user: userSelectField },
        orderBy: { dayOfWeek: "asc" },
      });

      // Group existing schedules by userId for O(1) matching checks
      const scheduleMap = flatSchedules.reduce(
        (acc, sched) => {
          if (!acc[sched.userId]) acc[sched.userId] = [];
          acc[sched.userId].push(sched);
          return acc;
        },
        {} as Record<string, typeof flatSchedules>,
      );

      const finalSchedulesList = [...flatSchedules];
      const missingSchedulePromises: Promise<any>[] = [];

      // Identify which users lack schedule structures completely
      for (const user of allUsers) {
        if (!scheduleMap[user.id] || scheduleMap[user.id].length === 0) {
          // Push creation tasks to a execution array instead of awaiting inside the loop
          const defaultSchedules = Array.from({ length: 7 }, (_, idx) => ({
            userId: user.id,
            dayOfWeek: idx,
            startTime: dayjs().hour(9).minute(0).second(0).toDate(),
            endTime: dayjs().hour(17).minute(0).second(0).toDate(), // Standardized to typical close offset
          }));

          const createPromise = prisma.$transaction(
            defaultSchedules.map((s) =>
              prisma.workSchedule.create({
                data: s,
                include: { user: userSelectField },
              }),
            ),
          );
          missingSchedulePromises.push(createPromise);
        }
      }

      // If new records need initial database seeds, run them concurrently
      if (missingSchedulePromises.length > 0) {
        const newlyCreatedBatches = await Promise.all(missingSchedulePromises);
        newlyCreatedBatches.forEach((batch) =>
          finalSchedulesList.push(...batch),
        );
      }

      // Sort the complete combined list nicely by dayOfWeek index
      finalSchedulesList.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
      return res.json(finalSchedulesList);
    }

    // --- STANDARD EMPLOYEE FLOW ---
    const schedule = await prisma.workSchedule.findMany({
      where: { userId },
      include: { user: userSelectField },
      orderBy: { dayOfWeek: "asc" },
    });

    return res.json(schedule);
  } catch (error) {
    console.error("Error fetching schedule architecture pipeline:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
interface ScheduleInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  is_off?: boolean;
  salary_type?: SalaryType;
  is_bonus_hourly?: boolean;
  is_content_bonus?: boolean;
  max_hour_allow?: number;
  expected_work_hour: number;
}

export const setWorkScheduleByUserId = async (req: Request, res: Response) => {
  const { userId: requesterId } = (req as any).user as { userId?: string };
  const { id: targetUserId, schedules } = req.body;

  // 1. Initial structural payload validation
  if (!targetUserId || !Array.isArray(schedules)) {
    return res
      .status(400)
      .json({ message: "Target user id and schedules array are required" });
  }

  try {
    // 2. Authorization check: Verify requester is an owner
    const currentOwnerCheck = await prisma.user.findUnique({
      where: { id: requesterId },
    });

    if (!currentOwnerCheck || currentOwnerCheck.isOwner === false) {
      return res.status(403).json({ message: "Only owner can set schedules" });
    }

    // 3. Target verification: Verify user exists before wiping data
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return res.status(404).json({ error: "Target user not found" });
    }

    // 4. Atomic Transaction: Delete old schedules and write the new batch safely
    const executionResult = await prisma.$transaction(async (tx) => {
      // Step A: Clear existing dataset
      await tx.workSchedule.deleteMany({
        where: { userId: targetUserId },
      });

      // Step B: Bulk generate formatting maps
      const creationPromises = (schedules as ScheduleInput[]).map((s) => {
        const isOffDay = !!s.is_off;

        return tx.workSchedule.create({
          data: {
            userId: targetUserId,
            dayOfWeek: s.dayOfWeek,
            startTime: new Date(s.startTime),
            endTime: new Date(s.endTime),
            is_off: isOffDay,
            salary_type: s.salary_type || SalaryType.A,
            is_content_bonus: !!s.is_content_bonus,
            is_bonus_hourly: !!s.is_bonus_hourly,
            max_hour_allow:
              s.max_hour_allow !== undefined ? s.max_hour_allow : 20,
            expected_work_hour: s.expected_work_hour,
          },
        });
      });

      return Promise.all(creationPromises);
    });

    return res.json({
      message: "Schedule updated successfully",
      schedules: executionResult,
    });
  } catch (error) {
    console.error("Error updating schedule architecture setup:", error);
    return res
      .status(500)
      .json({ error: "Internal server error processing error" });
  }
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
        },
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
        },
      );

      if (response.data?.data) {
        const filter = response.data.data.map((item: any) => ({
          ...item,
          created_at: formattedDate,
        }));
        allData.push(...filter);
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
    const bookedAppointments = await prisma.appointment.findMany({
      where: {
        assignedById: {
          in: [
            "6a0c3e58-d4e4-4f32-8585-9fbb81b08417",
            "bab24c5b-ec93-4386-bdfb-7b0e1f25eb7f",
            "317b8640-2920-4d1d-853f-c8552545e634",
          ],
        },
        // Using date conditions makes the query more efficient
        startTime: {
          gte: dayjs(startDate).subtract(1, "day").toDate(), // buffer to ensure we capture all appointments on the start date
          lte: dayjs(endDate).add(1, "day").toDate(), // buffer to ensure we capture all appointments on the end date
        },
      },
      select: { id: true, customerName: true },
    });
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
        },
      );

      if (response.data?.data) {
        const filter = response.data.data.map((item: any) => ({
          ...item,
          created_at: formattedDate,
        }));
        allData.push(...filter);
      }

      // Move to next day
      current.setDate(current.getDate() + 1);
    }
    // Filter only piercing items
    let piercingData = allData.filter(
      (item) =>
        item?.status?.toLowerCase() === "paid" ||
        item?.status?.toLowerCase() === "done",
    );
    let totalCountTattooForm = allData.filter(
      (k) => k.color !== "piercing",
    ).length;
    let totalCountTattooFormPaid = allData.filter(
      (k) =>
        k.color !== "piercing" && (k.status === "paid" || k.status === "done"),
    ).length;
    if (artist !== "All") {
      piercingData = piercingData?.filter(
        (k) => k?.artist?.toLowerCase() === artist?.toLowerCase(),
      );
    }

    return res.json({
      data: piercingData,
      bookedAppointments: bookedAppointments,
      count: {
        totalCountTattooForm: totalCountTattooForm,
        totalCountTattooFormPaid: totalCountTattooFormPaid,
      },
      tattooData: allData.filter((k) => k.color !== "piercing"),
    });
  } catch (error: any) {
    console.error("Error fetching piercing report:", error.message);
    return res.status(500).json({ message: "Failed to fetch report" });
  }
};

export const getPaystub = async (req: Request, res: Response) => {
  try {
    console.log("getPaystub called ");
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get current user
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // 👑 Owner → get all paystubs
    if (currentUser.isOwner) {
      const paystubs = await prisma.paystub.findMany({
        orderBy: {
          createdAt: "desc",
        },
      });
      console.log("Returning all paystubs for owner:", paystubs.length);
      return res.json(paystubs);
    }

    // 🙋 Normal user → get only their paystubs
    const paystubs = await prisma.paystub.findMany({
      where: {
        userId,
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(paystubs);
  } catch (error) {
    console.error("Error fetching paystubs:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllContentBonuses = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { isOwner: true, isAdmin: true },
    });

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!currentUser.isOwner) {
      return res.json({ success: true, data: [] });
    }

    const { start_date, end_date } = req.query as {
      start_date?: string;
      end_date?: string;
    };

    if (!start_date || !end_date) {
      return res.status(400).json({
        error: "Missing date range parameters (?start_date=X&end_date=Y)",
      });
    }

    // 1. Updated query to fetch wage and new_wage fields from the database
    const salesStaff = await prisma.user.findMany({
      where: { role: "employee", position: "saleContent", deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        wage: true, // Added
        new_wage: true, // Added
      },
    });

    if (salesStaff.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const staffIds = salesStaff.map((s) => s.id);

    const [shifts, savedBonuses, workSchedules] = await Promise.all([
      prisma.workShift.findMany({
        where: {
          userId: { in: staffIds },
          clockIn: {
            gte: dayjs(start_date).startOf("day").toDate(),
            lte: dayjs(end_date).endOf("day").toDate(),
          },
        },
        select: { userId: true, clockIn: true },
      }),
      prisma.contentBonus.findMany({
        where: {
          userId: { in: staffIds },
          date: { gte: start_date, lte: end_date },
        },
      }),
      prisma.workSchedule.findMany({
        where: { userId: { in: staffIds } },
        select: {
          userId: true,
          dayOfWeek: true,
          is_content_bonus: true,
          salary_type: true,
        },
      }),
    ]);

    // Lookup structures
    const workDaysMap: Record<string, Set<string>> = {};
    shifts.forEach((shift) => {
      if (!workDaysMap[shift.userId]) workDaysMap[shift.userId] = new Set();
      workDaysMap[shift.userId].add(dayjs(shift.clockIn).format("YYYY-MM-DD"));
    });

    const bonusLookup: Record<string, { amount: number; salary_type: string }> =
      {};
    savedBonuses.forEach((b) => {
      bonusLookup[`${b.userId}_${b.date}`] = {
        amount: b.content_bonus_amount,
        salary_type: b.salary_type ?? "A",
      };
    });

    const scheduleTemplateLookup: Record<
      string,
      { isEnabled: boolean; defaultSalaryType: string }
    > = {};
    workSchedules.forEach((sched) => {
      scheduleTemplateLookup[`${sched.userId}_${sched.dayOfWeek}`] = {
        isEnabled: !!sched.is_content_bonus,
        defaultSalaryType: sched.salary_type || "A",
      };
    });

    const startDay = dayjs(start_date);
    const endDay = dayjs(end_date);
    const totalDaysCount = endDay.diff(startDay, "day") + 1;

    const reportPayload = salesStaff.map((employee) => {
      const dailyBreakdown = [];
      let calculatedTotalBonus = 0;
      let actualDaysWorked = 0;

      for (let i = 0; i < totalDaysCount; i++) {
        const currentDayInstance = startDay.add(i, "day");
        const currentDayOfWeek = currentDayInstance.day();
        const scheduleKey = `${employee.id}_${currentDayOfWeek}`;

        const templateConfig = scheduleTemplateLookup[scheduleKey];

        if (!templateConfig?.isEnabled) {
          continue;
        }

        const currentDateStr = currentDayInstance.format("YYYY-MM-DD");
        const lookupKey = `${employee.id}_${currentDateStr}`;

        const didWork = workDaysMap[employee.id]?.has(currentDateStr) || false;
        if (didWork) actualDaysWorked++;

        let displaySalaryType = templateConfig.defaultSalaryType;
        let bonusAmount = 0;

        if (lookupKey in bonusLookup) {
          bonusAmount = bonusLookup[lookupKey].amount;
          if (bonusLookup[lookupKey].salary_type) {
            displaySalaryType = bonusLookup[lookupKey].salary_type;
          }
        }

        calculatedTotalBonus += bonusAmount;

        dailyBreakdown.push({
          date: currentDateStr,
          didWork,
          content_bonus_amount: bonusAmount,
          salary_type: displaySalaryType,
        });
      }

      return {
        // 2. Transformed employee key response data structure
        employee: {
          id: employee.id,
          name: employee.name,
          email: employee.email,
          wage: employee.wage ?? 0, // Added with safe default fallback
          new_wage: employee.new_wage ?? 0, // Added with safe default fallback
        },
        totalWorkDays: actualDaysWorked,
        totalBonusPayout: calculatedTotalBonus,
        dailyBreakdown,
      };
    });

    return res.json({ success: true, data: reportPayload });
  } catch (error: any) {
    console.error("Fetch content bonus pipeline error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// =========================================================================
// 2. UPSERT DAILY BONUS AMOUNT (Set explicit value or Tier Match)
// =========================================================================
export const saveDailyContentBonus = async (req: Request, res: Response) => {
  try {
    const { userId, date, amount, tierKey, salaryType } = req.body as {
      userId: string;
      date: string;
      amount?: number;
      tierKey?: string;
      salaryType?: "A" | "B";
    };

    if (!userId || !date) {
      return res
        .status(400)
        .json({ error: "userId and date fields are required" });
    }

    // 1. Determine the target bonus amount if changing payouts
    let targetAmount: number | undefined = undefined;

    if (tierKey) {
      const tierConfig = await prisma.quickBonusSetting.findUnique({
        where: { tier: tierKey.toUpperCase().trim() },
      });
      if (!tierConfig) {
        return res.status(404).json({
          error: `Bonus setup rule for Tier '${tierKey}' was not found`,
        });
      }
      targetAmount = tierConfig.amount;
    } else if (amount !== undefined) {
      targetAmount = amount;
    }

    // 2. Look up the existing record to know what to preserve
    const existingRecord = await prisma.contentBonus.findUnique({
      where: {
        userId_date: { userId, date },
      },
    });

    // 3. Formulate the absolute fallbacks for a new record creation
    let fallbackSalaryType = salaryType;
    if (!fallbackSalaryType) {
      const dayOfWeekIndex = dayjs(date).day();
      const templateMatch = await prisma.workSchedule.findFirst({
        where: {
          userId: userId,
          dayOfWeek: dayOfWeekIndex,
        },
        select: { salary_type: true },
      });
      fallbackSalaryType = (templateMatch?.salary_type as "A" | "B") || "A";
    }

    // 4. Fire the patch-style upsert execution safely
    const updatedRecord = await prisma.contentBonus.upsert({
      where: {
        userId_date: { userId, date },
      },
      update: {
        // If a property isn't passed, look to existing data first, then fall back
        content_bonus_amount:
          targetAmount !== undefined
            ? targetAmount
            : existingRecord?.content_bonus_amount,
        salary_type:
          salaryType !== undefined ? salaryType : existingRecord?.salary_type,
      },
      create: {
        userId,
        date,
        content_bonus_amount: targetAmount !== undefined ? targetAmount : 0,
        salary_type: fallbackSalaryType,
      },
    });

    return res.json({ success: true, data: updatedRecord });
  } catch (error: any) {
    console.error("Save daily configuration error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// =========================================================================
// 3. SEED / UPDATE QUICK MATCHING SETTING VALUES (Tier Administration)
// =========================================================================
export const updateQuickBonusSettings = async (req: Request, res: Response) => {
  try {
    const { settings } = req.body as { settings: Record<string, number> };
    // Format expected: { "A": 50, "B": 100, "C": 150 }

    if (!settings || Object.keys(settings).length === 0) {
      return res
        .status(400)
        .json({ error: "Configuration object dictionary required" });
    }

    const updates = Object.entries(settings).map(([tier, amount]) =>
      prisma.quickBonusSetting.upsert({
        where: { tier: tier.toUpperCase().trim() },
        update: { amount },
        create: { tier: tier.toUpperCase().trim(), amount },
      }),
    );

    await Promise.all(updates);
    const updatedRules = await prisma.quickBonusSetting.findMany();

    return res.json({ success: true, data: updatedRules });
  } catch (error: any) {
    console.error("Modify configuration rules error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// =========================================================================
// 4. GET QUICK MATCHING CONFIGURATIONS
// =========================================================================
export const getQuickBonusSettings = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get current user status
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { isOwner: true, isAdmin: true },
    });

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // 3. Graceful Guardian: If not an owner, return an empty data array instead of a 403 error
    if (!currentUser.isOwner) {
      return res.json({ success: true, data: [] });
    }

    // 4. Proceed with data retrieval if validation passes
    const settings = await prisma.quickBonusSetting.findMany({
      orderBy: { tier: "asc" },
    });

    return res.json({ success: true, data: settings });
  } catch (error: any) {
    console.error("Get Quick Bonus configurations error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
