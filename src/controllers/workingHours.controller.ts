import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const setWorkingHours = async (req: Request, res: Response) => {
  const { userId, isAdmin } = (req as any).user;
  const {
    type,
    weekday,
    startTime,
    endTime,
    intervalLength,
    intervals,
    employeeId,
  } = req.body;

  if (typeof weekday !== "number" || weekday < 0 || weekday > 6) {
    return res.status(400).json({ message: "Invalid weekday (0–6 expected)" });
  }

  if (!type || !["fixed", "interval", "custom"].includes(type)) {
    return res.status(400).json({ message: "Invalid type" });
  }

  const targetId = isAdmin ? employeeId : userId;

  try {
    await prisma.workingHours.deleteMany({
      where: { employeeId: targetId, weekday },
    });

    if (type === "custom") {
      if (!Array.isArray(intervals) || intervals.length === 0) {
        return res
          .status(400)
          .json({ message: "Intervals must be a non-empty array" });
      }

      for (const interval of intervals) {
        if (!interval.startTime || typeof interval.startTime !== "string") {
          return res
            .status(400)
            .json({ message: "Missing or invalid startTime" });
        }
        if (interval.endTime && typeof interval.endTime !== "string") {
          return res.status(400).json({ message: "Invalid endTime format" });
        }
      }

      await prisma.workingHours.createMany({
        data: intervals.map((i: any) => ({
          employeeId: targetId,
          weekday,
          startTime: i.startTime,
          endTime: i.endTime ?? null,
          type: "custom",
        })),
      });
    } else if (type === "fixed" || type === "interval") {
      if (!startTime || !endTime) {
        return res
          .status(400)
          .json({ message: "startTime and endTime are required" });
      }

      const interval = parseInt(intervalLength)

      await prisma.workingHours.create({
        data: {
          employeeId: targetId,
          weekday,
          startTime,
          endTime,
          intervalLength: type === "interval" ? interval ?? 60 : null,
          type,
        },
      });
    }

    res.status(200).json({ message: "Working hours saved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save working hours" });
  }
};

export const getWorkingHours = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const weekday = parseInt(req.params.weekday);

  if (isNaN(weekday) || weekday < 0 || weekday > 6) {
    return res.status(400).json({ message: "Invalid weekday" });
  }

  try {
    const hours = await prisma.workingHours.findMany({
      where: { employeeId: userId, weekday },
      orderBy: { weekday: "asc" },
    });

    res.json(hours);
  } catch (error) {
    console.error("Error getting working hours", error);
    return res.status(500).json({ message: "Error fetching working hours" });
  }
};

export const getAllWorkingHours = async (req: Request, res: Response) => {
  const { userId, isAdmin } = (req as any).user || {};

  const requestedEmployeeId = (
    req.query.employeeId as string | undefined
  )?.trim();

  console.log(requestedEmployeeId);
  const idToQuery = isAdmin ? requestedEmployeeId : userId;

  try {
    const hours = await prisma.workingHours.findMany({
      where: { employeeId: idToQuery },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    });

    res.json(hours);
  } catch (err) {
    console.error("Error loading all working hours:", err);
    res.status(500).json({ message: "Failed to load working hours." });
  }
};
