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
    select: { isOwner: true },
  });

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  let employees;

  if (currentUser?.isOwner) {
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
        percentage_shared: true,
        wage: true,
        show_on_calendar_booking: true,
        isAdmin: true,
        role: true,
        is_reception: true,
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
        percentage_shared: true,
        wage: true,
        show_on_calendar_booking: true,
        isAdmin: true,
        role: true,
        is_reception: true,
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
  if (!currentUser?.isAdmin && !currentUser?.isOwner) {
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
    percentage_shared,
    wage,
    show_on_calendar_booking,
    is_reception,
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
        percentage_shared,
        wage,
        show_on_calendar_booking,
        is_reception,
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
        percentage_shared: true,
        wage: true,
        show_on_calendar_booking: true,
        is_reception: true,
      },
    });
    console.log("Updated employee:", updatedEmployee);
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

export const getCleanSchedules = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    console.log("Fetching clean schedules for user:", userId);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    let schedules = await prisma.cleanSchedule.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ userId: "asc" }, { weekday: "asc" }],
    });

    // ✅ If empty, create default 7-day schedules (no user assigned)
    if (schedules.length === 0) {
      const defaultSchedules = Array.from({ length: 7 }, (_, i) => ({
        weekday: i,
        userId: userId,
      }));

      await prisma.cleanSchedule.createMany({ data: defaultSchedules });

      // fetch again with fresh data
      schedules = await prisma.cleanSchedule.findMany({
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ userId: "asc" }, { weekday: "asc" }],
      });
    }

    res.json(schedules);
  } catch (err) {
    console.error("Error loading clean schedules:", err);
    res.status(500).json({ message: "Failed to load clean schedules." });
  }
};

// ✅ Assign or edit clean schedule
export const assignUserToCleanSchedule = async (
  req: Request,
  res: Response
) => {
  const { isOwner } = (req as any).user || {};
  console.log("Assigning clean schedule, isOwner:", isOwner);
  if (!isOwner) {
    return res
      .status(403)
      .json({ message: "Only owners can assign schedules" });
  }

  let { userId, weekdays } = req.body;
  console.log("Received schedule assignment:", req.body);

  // Normalize weekdays → always array of numbers
  if (!userId || weekdays === undefined) {
    return res.status(400).json({ message: "Invalid input" });
  }
  if (!Array.isArray(weekdays)) {
    weekdays = [Number(weekdays)]; // convert single value like "0" → [0]
  } else {
    weekdays = weekdays.map((w: any) => Number(w));
  }

  try {
    // Ensure default schedule exists (7 days, userId empty if not already created)
    const count = await prisma.cleanSchedule.count();
    if (count < 7) {
      const defaultData = Array.from({ length: 7 }, (_, i) => ({
        weekday: i,
        userId: "", // empty string for unassigned
      }));
      await prisma.cleanSchedule.createMany({
        data: defaultData,
        skipDuplicates: true,
      });
    }

    // Update schedules by replacing userId on matching weekdays
    for (const day of weekdays) {
      await prisma.cleanSchedule.updateMany({
        where: { weekday: day },
        data: { userId },
      });
    }

    res.json({ message: "Clean schedule updated successfully" });
  } catch (err) {
    console.error("Error assigning clean schedule:", err);
    res.status(500).json({ message: "Failed to update clean schedule" });
  }
};
