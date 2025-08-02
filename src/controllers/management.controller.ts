import { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getAllEmployees = async (_req: Request, res: Response) => {
  const employees = await prisma.user.findMany({
    where: { role: "employee" },
    select: {
      id: true,
      name: true,
      photo_url: true,
      start_price: true,
      colour: true,
    },
  });
  res.json(employees);
};

export const editEmployee = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  const { name, start_price, colour } = req.body;

  try {
    const updatedEmployee = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        start_price,
        colour,
      },
      select: {
        id: true,
        name: true,
        photo_url: true,
        start_price: true,
        colour: true,
      },
    });

    res.json(updatedEmployee);
  } catch (error) {
    console.error("Failed to update employee", error);
    res.status(500).json({ message: "Failed to update employee" });
  }
};
