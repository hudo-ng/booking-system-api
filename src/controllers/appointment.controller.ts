import { Request, Response } from "express";
import { PrismaClient, AppointmentStatus } from "@prisma/client";
import { trackAppointmentHistory } from "../utils/trackChanges";

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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  if (!user) throw new Error("User not found");
  const changedBy = user.name;
  await trackAppointmentHistory(
    id,
    appt,
    { startTime, endTime, status },
    changedBy
  );

  const updated = await prisma.appointment.update({
    where: { id },
    data,
  });
  res.json(updated);
};

export const updateAppointment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { startTime, endTime, status } = req.body;

  const { userId, role } = (req as any).user as {
    userId: string;
    role: string;
  };

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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  if (!user) throw new Error("User not found");
  const changedBy = user.name;
  await trackAppointmentHistory(
    id,
    appointment,
    { startTime, endTime, status },
    changedBy
  );

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

export const getAppointmentHistory = async (req: Request, res: Response) => {
  const { id: appointmentId } = req.params;
  try {
    const history = await prisma.appointmentHistory.findMany({
      where: { appointmentId },
      orderBy: { changedAt: "desc" },
    });
    res.json(history);
  } catch (err) {
    console.error("Failed to fetch appointment history:", err);
    res.status(500).json({ message: "Failed to fetch appointment history" });
  }
};
