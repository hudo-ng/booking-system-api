import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { getDistanceFromLatLonInKm } from "../utils/distance";
import axios, { all } from "axios";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { sendPushAsync } from "../services/push";

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

    // If NO request exists, they are stuck and must submit one
    if (!pendingRequest) {
      const missedDate = dayjs(openShift.clockIn).format("MMM DD, YYYY");
      return res.status(400).json({
        message: `Cannot clock in. You haven't clocked out of your shift on ${missedDate}. Please submit a correction request first.`,
        openShiftId: openShift.id,
        missedDate,
      });
    }

    // If a request DOES exist, we ignore the open shift and let them proceed to step 2
    console.log(
      `User ${userId} has a pending request for shift ${openShift.id}. Allowing new clock-in.`,
    );
  }

  // 2. Schedule Validation
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

  // 3. Create New Shift
  const shift = await prisma.workShift.create({
    data: {
      userId,
      clockIn: nowChicago.toDate(),
    },
  });

  return res.json({ message: "Clocked in successfully", shift });
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
              }),
            ),
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
      }),
    ),
  );
  console.log("New schedules set for userId", id, newSchedules);
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
    if (artist !== "All") {
      piercingData = piercingData?.filter(
        (k) => k?.artist?.toLowerCase() === artist?.toLowerCase(),
      );
    }

    return res.json({ data: piercingData });
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
