import { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

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
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Query the current user
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  // Check if user is admin
  if (!currentUser?.isAdmin) {
    return res.status(403).json({ error: "You do not have permission" });
  }
  const { staff_id, name, start_price, colour } = req.body;

  try {
    const updatedEmployee = await prisma.user.update({
      where: { id: staff_id },
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

export const addEmployee = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Query the current user
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user is admin
    if (!currentUser?.isAdmin) {
      return res.status(403).json({ error: "You do not have permission" });
    }

    const { email, password, name, colour, start_price, phone_number } =
      req.body;

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name,
        role: "employee",
        colour,
        start_price,
        isAdmin: false,
        phone_number,
      },
    });

    return res
      .status(201)
      .json({ id: user.id, email: user.email, role: user.role });
  } catch (error) {
    console.error("Error creating employee:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
