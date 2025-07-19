import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

const prisma = new PrismaClient();

export const requestBooking = async (req: Request, res: Response) => {
  const { id: employeeId } = req.params;
  const { date, startTime, customerName, email, phone, detail } = req.body as {
    date: string;
    startTime: string;
    customerName: string;
    email: string;
    phone: string;
    detail: string;
  };
  // verify employee exists
  const employee = await prisma.user.findUnique({
    where: { id: employeeId },
  });
  if (!employee || employee.role !== "employee") {
    return res.status(404).json({ message: "Employee not found" });
  }
  // check start time
  const start = dayjs(`${date}T${startTime}`);
  if (!start.isValid() || start.isBefore(dayjs())) {
    return res.status(400).json({ message: "Invalid or past start time" });
  }
  // check working hours for that weekday
  const weekday = start.day();
  const hours = await prisma.workingHours.findFirst({
    where: { employeeId, weekday },
  });
  if (!hours) {
    return res
      .status(404)
      .json({ message: "No working hours set for this day" });
  }
  const workStart = dayjs(`${date}T${hours.startTime}`);
  const workEnd = dayjs(`${date}T${hours.endTime}`);
  if (start.isBefore(workStart) || start.isAfter(workEnd.subtract(1, "hour"))) {
    return res
      .status(400)
      .json({ message: "Requested time is outside of working hours" });
  }
  // exclude full day time off
  const off = await prisma.timeOff.findFirst({
    where: { employeeId, date: start.startOf("day").toDate() },
  });
  if (off) {
    return res.status(400).json({ message: "Employee is off on that day" });
  }
  // exclude conflicts with accepted appointments
  const end = start.add(1, "hour");
  const conflict = await prisma.appointment.findFirst({
    where: {
      employeeId,
      status: "accepted",
      OR: [
        {
          startTime: {
            lte: start.toDate(),
          },
          endTime: {
            gt: start.toDate(),
          },
        },
        {
          startTime: {
            lt: end.toDate(),
          },
          endTime: {
            gte: end.toDate(),
          },
        },
      ],
    },
  });
  if (conflict) {
    return res.status(400).json({ message: "Time slot already booked!" });
  }
  // if all above conds met, creat pending appointment
  const appt = await prisma.appointment.create({
    data: {
      employeeId,
      customerName,
      email,
      phone,
      detail,
      status: "pending",
      startTime: start.toDate(),
    },
  });
  res.status(201).json(appt);
};
