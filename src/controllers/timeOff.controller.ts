import { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { randomUUID } from "crypto";
import { sendPushAsync } from "../services/push";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();
const ZONE = "America/Chicago";

export const setTimeOff = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const { date, reason } = req.body;

  const localStart = dayjs.tz(date, "YYYY-MM-DD", ZONE).startOf("day");
  const storeUtc = localStart.toDate();

  const start = localStart.utc();
  const end = localStart.add(1, "day").utc();

  const exists = await prisma.timeOff.findFirst({
    where: {
      employeeId: userId,
      date: { gte: start.toDate(), lt: end.toDate() },
    },
  });
  if (exists) return res.status(409).json({ message: "Already off that day" });

  const entry = await prisma.timeOff.create({
    data: { employeeId: userId, date: storeUtc, reason },
  });
  res.json(entry);
};

export const getTimeOffAll = async (req: Request, res: Response) => {
  const { role } = (req as any).user;

  if (role !== "admin")
    return res.status(403).json({ message: "Unauthorized" });

  const offs = await prisma.timeOff.findMany({
    where: { status: "PENDING" },
    include: {
      employee: {
        select: { name: true, email: true, id: true },
      },
    },
    orderBy: { date: "desc" },
  });

  res.json(offs);
};
export const getTimeOffAlls = async (req: Request, res: Response) => {
  const { role } = (req as any).user;

  if (role !== "admin")
    return res.status(403).json({ message: "Unauthorized" });

  const offs = await prisma.timeOff.findMany({
    include: {
      employee: {
        select: { name: true, email: true, id: true },
      },
    },
    orderBy: { date: "desc" },
  });

  res.json(offs);
};
export const getTimeOffWithFilter = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const { status } = req.query as {
    status?: "PENDING" | "APPROVED" | "REJECTED";
  };

  const offs = await prisma.timeOff.findMany({
    where: {
      employeeId: userId,
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { date: "desc" }],
  });

  res.json(offs);
};

export const setTimeOffBulk = async (req: Request, res: Response) => {
  const { userId } = (req as any).user;
  const { dates, reason } = req.body as { dates: string[]; reason?: string };

  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ message: "dates must be a non-empty array" });
  }

  const normalized = Array.from(
    new Set(dates.map((d) => dayjs(d).format("YYYY-MM-DD"))),
  );

  const toCreate: {
    employeeId: string;
    date: Date;
    reason?: string;
    status: "PENDING";
    batchId: string;
  }[] = [];
  const batchId = randomUUID();

  for (const d of normalized) {
    const localStart = dayjs.tz(d, "YYYY-MM-DD", ZONE).startOf("day");
    const start = localStart.utc();
    const end = localStart.add(1, "day").utc();

    const exists = await prisma.timeOff.findFirst({
      where: {
        employeeId: userId,
        date: { gte: start.toDate(), lt: end.toDate() },
      },
    });

    if (!exists) {
      toCreate.push({
        employeeId: userId,
        date: localStart.toDate(),
        reason,
        status: "PENDING",
        batchId,
      });
    }
  }

  if (toCreate.length === 0) {
    return res
      .status(409)
      .json({ message: "All requested dates already exist" });
  }

  const created = await prisma.timeOff.createMany({ data: toCreate });
  const createdItems = await prisma.timeOff.findMany({
    where: { batchId, employeeId: userId },
    orderBy: { date: "asc" },
  });

  (async () => {
    try {
      const employee = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

      const relevantUsers = await prisma.user.findMany({
        where: {
          OR: [{ isOwner: true }, { isAdmin: true }, { is_reception: true }],
        },
        select: { id: true },
      });

      const targetUserIds = relevantUsers.map((u) => u.id);

      const tokens = (
        await prisma.deviceToken.findMany({
          where: {
            userId: { in: targetUserIds },
            enabled: true,
          },
          select: { token: true },
        })
      ).map((d) => d.token);

      if (tokens.length) {
        await sendPushAsync(tokens, {
          title: "New Day-Off Request",
          body: `${employee?.name || "Employee"} requested ${toCreate.length} day(s) off`,
          data: {
            type: "DAY_OFF_REQUEST",
            batchId,
          },
        });
      }
    } catch (err) {
      console.error("Day-off push error:", err);
    }
  })();

  res.json({ batchId, count: created.count, items: createdItems });
};

export const setTimeOffStatus = async (req: Request, res: Response) => {
  const { role, userId: reviewerId } = (req as any).user;
  if (role !== "admin") return res.status(403).json({ message: "Forbidden" });

  const { id } = req.params;
  const { status } = req.body as { status: "APPROVED" | "REJECTED" };

  if (!["APPROVED", "REJECTED"].includes(status))
    return res.status(400).json({ message: "Invalid status" });

  const updated = await prisma.timeOff.update({
    where: { id },
    data: { status, reviewedAt: new Date(), reviewedBy: reviewerId },
  });

  res.json(updated);
};

export const setTimeOffBatchStatus = async (req: Request, res: Response) => {
  const { role, userId: reviewerId } = (req as any).user;
  if (role !== "admin") return res.status(403).json({ message: "Forbidden" });

  const { batchId } = req.params;
  const { status } = req.body as { status: "APPROVED" | "REJECTED" };

  if (!["APPROVED", "REJECTED"].includes(status))
    return res.status(400).json({ message: "Invalid status" });

  const result = await prisma.$transaction(async (tx) => {
    await tx.timeOff.updateMany({
      where: { batchId },
      data: { status, reviewedAt: new Date(), reviewedBy: reviewerId },
    });
    return tx.timeOff.findMany({
      where: { batchId },
      orderBy: { date: "asc" },
    });
  });

  res.json({ batchId, items: result });
};
