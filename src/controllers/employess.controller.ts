import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const listEmployees = async (_req: Request, res: Response) => {
  const employees = await prisma.user.findMany({
    where: { role: "employee", deletedAt: null },
    select: {
      id: true,
      name: true,
      photo_url: true,
      start_price: true,
      colour: true,
      slug: true,
      show_on_calendar_booking: true,
      is_reception: true,
      isOwner: true,
      isAdmin: true,
      email: true,
    },
  });
  res.json(employees);
};

export const getEmployeeId = async (req: Request, res: Response) => {
  const { employeeSlug } = req.params;
  const employee = await prisma.user.findUnique({
    where: { slug: employeeSlug },
    select: {
      id: true,
      slug: true,
    },
  });
  res.json(employee);
};
