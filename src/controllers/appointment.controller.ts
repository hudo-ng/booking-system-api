import { Request, Response } from "express";
import { PrismaClient, AppointmentStatus } from "@prisma/client";

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
  const updated = await prisma.appointment.update({
    where: { id },
    data,
  });
  res.json(updated);
};
