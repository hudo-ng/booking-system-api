import { Request, Response } from "express";
import { PrismaClient, AppointmentStatus } from "@prisma/client";
import dayjs from "dayjs";

const prisma = new PrismaClient();

export const getAppointments = async (req: Request, res: Response) => {
  const { userId, role } = (req as any).user as {
    userId: string;
    role: string;
  };
  const roleToSearch = role === "employee" ? { employeeId: userId } : {};
  const appointments = await prisma.appointment.findMany({
    where: roleToSearch,
    orderBy: { createdAt: "desc" },
    include: {
      employee: {
        select: { id: true, name: true },
      },
    },
  });
  res.json(appointments);
};

export const getAllAppointments = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  const { year, month } = req.query as { year?: string; month?: string };

  if (!userId) {
    return res.json([]);
  }

  let dateFilter = {};

  if (year && month) {
    // Convert query params to integers
    const y = parseInt(year, 10);
    const m = parseInt(month, 10); // 1-based month

    const startOfMonth = dayjs(`${y}-${m}-01`).startOf("month").toDate();
    const endOfMonth = dayjs(`${y}-${m}-01`).endOf("month").toDate();

    // If you want appointments overlapping the month:
    dateFilter = {
      AND: [
        { startTime: { lte: endOfMonth } },
        { endTime: { gte: startOfMonth } },
      ],
    };
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      employeeId: userId,
      ...dateFilter,
    },
    orderBy: { createdAt: "desc" },
    include: {
      employee: {
        select: { id: true, name: true },
      },
    },
  });

  res.json(appointments);
};

export const getAppointmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // appointment ID from URL param

    if (!id) {
      return res.status(400).json({ message: "Appointment ID is required" });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        employee: {
          select: { id: true, name: true },
        },
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    return res.json(appointment);
  } catch (error) {
    console.error("getAppointmentById error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateAppointmentStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, startTime, endTime } = req.body as {
    status: AppointmentStatus;
    startTime?: string;
    endTime?: string;
  };
  const { userId, role } = (req as any).user as {
    userId: string;
    role: string;
  };
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) return res.status(403).json({ message: "Not found" });
  if (role === "employee" && appt.employeeId !== userId) return res.status(403);
  const data: any = { status };
  if (status === "accepted") {
    data.startTime = new Date(startTime!);
    data.endTime = new Date(endTime!);
  }
  const updated = await prisma.appointment.update({
    where: { id },
    data,
  });
  res.json(updated);
};

export const updateAppointment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { startTime, endTime, status } = req.body;

  if (!startTime || !endTime) {
    return res.status(400).json({ message: "Start and end time required." });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment)
    return res.status(404).json({ message: "Appointment not found." });

  const employeeId = appointment.employeeId;
  const newStart = new Date(startTime);
  const newEnd = new Date(endTime);

  // Conflict check for accepted appointments
  const conflict = await prisma.appointment.findFirst({
    where: {
      id: { not: id },
      employeeId,
      status: "accepted",
      startTime: { lt: newEnd },
      endTime: { gt: newStart },
    },
  });

  if (conflict) {
    return res.status(400).json({
      message: "This time overlaps with another accepted appointment.",
    });
  }

  try {
    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        startTime: newStart,
        endTime: newEnd,
        status,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error("Update failed", err);
    res.status(500).json({ message: "Failed to update appointment" });
  }
};
