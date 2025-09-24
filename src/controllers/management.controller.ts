import { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import slugify from "slugify";
import { customAlphabet } from "nanoid";

const prisma = new PrismaClient();

export const getAllEmployees = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Get current user
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, isOwner: true },
  });

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  let employees;

  if (currentUser.isAdmin || currentUser?.isOwner) {
    // Return all employees
    employees = await prisma.user.findMany({
      where: { role: "employee" },
      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        start_price: true,
        colour: true,
        photo_url: true,
        percentage_clean: true,
        percentage_work: true,
        show_on_calendar_booking: true,
        isAdmin: true,
        role: true,
      },
    });
  } else {
    // Return only current user
    const employee = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        start_price: true,
        colour: true,
        photo_url: true,
        percentage_clean: true,
        percentage_work: true,
        show_on_calendar_booking: true,
        isAdmin: true,
        role: true,
      },
    });

    employees = employee ? [employee] : [];
  }

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

  const {
    staff_id,
    name,
    phone_number,
    start_price,
    colour,
    photo_url,
    percentage_clean,
    percentage_work,
    show_on_calendar_booking,
  } = req.body;
  console.log("Editing employee with ID:", req.body);
  try {
    const updatedEmployee = await prisma.user.update({
      where: { id: staff_id },
      data: {
        name,
        phone_number,
        start_price,
        colour,
        photo_url,
        percentage_clean,
        percentage_work,
        show_on_calendar_booking,
      },
      select: {
        id: true,
        name: true,
        phone_number: true,
        start_price: true,
        colour: true,
        photo_url: true,
        percentage_clean: true,
        percentage_work: true,
        show_on_calendar_booking: true,
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

    const {
      email,
      password,
      name,
      colour,
      start_price,
      phone_number,
      isAdmin,
    } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    const nano = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 5);
    const base =
      slugify(currentUser.name || "user", { lower: true, strict: true }) ||
      "user";
    const slug = `${base}-${nano()}`;

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name,
        role: "employee",
        colour,
        start_price,
        isAdmin: isAdmin,
        phone_number,
        slug,
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

export const getAllNotification = async (req: Request, res: Response) => {
  try {
    const notifications = await prisma.notification.findMany({
      orderBy: { created_at: "desc" },
      take: 30, // limit to 30 results
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
      },
    });
    res.json(notifications);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
};
