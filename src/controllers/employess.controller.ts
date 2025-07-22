import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const listEmployees = async (_req: Request, res: Response) => {
  const employees = await prisma.user.findMany({
    where: { role: "employee" },
    select: { id: true, name: true, photo_url: true, start_price: true },
  });
  res.json(employees);
};
