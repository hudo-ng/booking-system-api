import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

const prisma = new PrismaClient();

export const requestBooking = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const { date, startTime, endTime, customerName, email, phone, detail } =
    req.body as {
      date: string;
      startTime: string;
      endTime: string;
      customerName: string;
      email: string;
      phone: string;
      detail: string;
    };

  const employee = await prisma.user.findUnique({ where: { id: employeeId } });
  if (!employee || employee.role !== "employee") {
    return res.status(404).json({ message: "Employee not found" });
  }
  const start = dayjs(startTime);
  const end = dayjs(endTime);

  if (!start.isValid() || !end.isValid()) {
    return res.status(400).json({ message: "Invalid start or end time" });
  }

  if (start.isBefore(dayjs())) {
    return res.status(400).json({ message: "Cannot book past times" });
  }

  const off = await prisma.timeOff.findFirst({
    where: { employeeId, date: start.startOf("day").toDate() },
  });
  if (off) {
    return res.status(400).json({ message: "Employee is off on that day" });
  }

  const conflict = await prisma.appointment.findFirst({
    where: {
      employeeId,
      status: "accepted",
      OR: [
        {
          startTime: { lt: end.toDate() },
          endTime: { gt: start.toDate() },
        },
      ],
    },
  });
  if (conflict) {
    return res.status(400).json({ message: "Time slot already booked!" });
  }

  const appt = await prisma.appointment.create({
    data: {
      employeeId,
      customerName,
      email,
      phone,
      detail,
      status: "pending",
      startTime: start.toDate(),
      endTime: end.toDate(),
    },
  });

  return res.status(201).json(appt);
};
