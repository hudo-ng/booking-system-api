import { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import slugify from "slugify";
import { customAlphabet } from "nanoid";
import { sendSMS } from "../utils/sms";

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
      where: { role: "employee", deletedAt: null },
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
        currentDeviceId: true,
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
        currentDeviceId: true,
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

export const deleteEmployee = async (req: Request, res: Response) => {
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

  // Only admin or owner can delete staff
  if (!currentUser?.isAdmin && !currentUser?.isOwner) {
    return res.status(403).json({ error: "You do not have permission" });
  }

  const { staff_id } = req.body;

  if (!staff_id) {
    return res.status(400).json({ error: "staff_id is required" });
  }

  try {
    const deletedEmployee = await prisma.user.update({
      where: { id: staff_id },
      data: {
        deletedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        deletedAt: true,
      },
    });

    res.json({
      message: "Employee soft-deleted successfully",
      employee: deletedEmployee,
    });
  } catch (error) {
    console.error("Failed to soft-delete employee", error);
    res.status(500).json({ message: "Failed to delete employee" });
  }
};

export const deleteDeviceToken = async (req: Request, res: Response) => {
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

  // Only admin or owner can delete staff
  if (!currentUser?.isAdmin && !currentUser?.isOwner) {
    return res.status(403).json({ error: "You do not have permission" });
  }

  const { staff_id } = req.body;

  if (!staff_id) {
    return res.status(400).json({ error: "staff_id is required" });
  }

  try {
    const deletedEmployee = await prisma.user.update({
      where: { id: staff_id },
      data: {
        currentDeviceId: null,
      },
      select: {
        id: true,
        name: true,
      },
    });

    res.json({
      message: "Employee soft-deleted successfully",
      employee: deletedEmployee,
    });
  } catch (error) {
    console.error("Failed to soft-delete employee", error);
    res.status(500).json({ message: "Failed to delete employee" });
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
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let schedules = await prisma.cleanSchedule.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ weekday: "asc" }, { shiftType: "asc" }],
    });

    if (schedules.length === 0) {
      const defaultSchedules = Array.from({ length: 7 * 2 }, (_, i) => ({
        weekday: i % 7,
        shiftType: i < 7 ? "day" : "night",
        userId: "",
      }));

      await prisma.cleanSchedule.createMany({ data: defaultSchedules });

      schedules = await prisma.cleanSchedule.findMany({
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ weekday: "asc" }, { shiftType: "asc" }],
      });
    }

    res.json(schedules);
  } catch (err) {
    console.error("Error loading clean schedules:", err);
    res.status(500).json({ message: "Failed to load clean schedules." });
  }
};

export const assignUserToCleanSchedule = async (
  req: Request,
  res: Response
) => {
  const currentUser = await prisma.user.findUnique({
    where: { id: (req as any).user.userId },
    select: { isOwner: true },
  });

  if (!currentUser?.isOwner) {
    return res
      .status(403)
      .json({ message: "Only owners can assign schedules" });
  }

  let { userId, weekdays, shiftType = "day" } = req.body;
  console.log("Received schedule assignment:", req.body);

  if (!userId || weekdays === undefined) {
    return res.status(400).json({ message: "Invalid input" });
  }

  const days = Array.isArray(weekdays)
    ? weekdays.map((w: any) => Number(w))
    : [Number(weekdays)];

  const systemUser = await prisma.user.findUnique({
    where: { email: "default@system.com" },
  });
  if (!systemUser) throw new Error("System user missing! Please create one.");

  try {
    const count = await prisma.cleanSchedule.count();
    if (count < 14) {
      const defaultData = Array.from({ length: 14 }, (_, i) => ({
        weekday: i % 7,
        shiftType: i < 7 ? "day" : "night",
        userId: systemUser.id,
      }));
      await prisma.cleanSchedule.createMany({
        data: defaultData,
        skipDuplicates: true,
      });
    }

    for (const day of days) {
      await prisma.cleanSchedule.deleteMany({
        where: { weekday: day, shiftType },
      });

      await prisma.cleanSchedule.create({
        data: { weekday: day, shiftType, userId },
      });
    }

    res.json({ message: `Clean schedule (${shiftType}) updated successfully` });
  } catch (err) {
    console.error("Error assigning clean schedule:", err);
    res.status(500).json({ message: "Failed to update clean schedule" });
  }
};

export const releaseSms = async (req: Request, res: Response) => {
  try {
    const { phone, text } = req.body;

    // ✅ Validate input
    if (!phone || !text) {
      return res.status(400).json({
        message: "Phone number and text message are required.",
      });
    }

    // ✅ Send SMS using your helper
    const result = await sendSMS(phone, text);

    return res.status(200).json({
      message: "SMS sent successfully.",
      result,
    });
  } catch (error: any) {
    console.error("Error sending SMS:", error);
    return res.status(500).json({
      message: "Failed to send SMS.",
      error: error.message || error,
    });
  }
};

export const getAllMiniPhoto = async (req: Request, res: Response) => {
  try {
    const photos = await prisma.miniPhoto.findMany({
      orderBy: { created_at: "desc" },
    });
    res.json(photos);
  } catch (error) {
    console.error("Failed to fetch mini photos:", error);
    res.status(500).json({ message: "Failed to fetch mini photos" });
  }
};

// Helper function to get next available custom_id
const getNextCustomId = async (): Promise<string> => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // 1. Find all existing custom_ids
  const allPhotos = await prisma.miniPhoto.findMany({
    select: { custom_id: true },
  });

  // 2. Build a set of existing custom_ids for fast lookup
  const existingIds = new Set(allPhotos.map((p) => p.custom_id));

  // 3. Start from number 1, loop until we find an unused id
  let number = 1;

  while (true) {
    for (const letter of letters) {
      const candidateId = `${letter}${number}`;
      if (!existingIds.has(candidateId)) {
        return candidateId;
      }
    }
    number++; // increment number only after trying all letters
  }
};

export const createMiniPhoto = async (req: Request, res: Response) => {
  try {
    const { photo_url, style, created_by, is_showed, category } = req.body;

    if (!photo_url || !created_by) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newCustomId = await getNextCustomId();

    const newPhoto = await prisma.miniPhoto.create({
      data: {
        custom_id: newCustomId,
        photo_url,
        style,
        category,
        created_by,
        is_showed: is_showed ?? false,
      },
    });

    res.status(201).json(newPhoto);
  } catch (error) {
    console.error("Failed to create mini photo:", error);
    res.status(500).json({ message: "Failed to create mini photo" });
  }
};

export const updateMiniPhoto = async (req: Request, res: Response) => {
  try {
    const { id, is_showed, category, style, photo_url } = req.body;

    if (!id) return res.status(400).json({ message: "Missing id" });

    // build partial update object (only include provided fields)
    const dataToUpdate: any = {};
    if (typeof is_showed !== "undefined") dataToUpdate.is_showed = is_showed;
    if (typeof category !== "undefined") dataToUpdate.category = category;
    if (typeof style !== "undefined") dataToUpdate.style = style;
    if (typeof photo_url !== "undefined") dataToUpdate.photo_url = photo_url;

    if (Object.keys(dataToUpdate).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    const updated = await prisma.miniPhoto.update({
      where: { id },
      data: dataToUpdate,
    });

    res.json(updated);
  } catch (error) {
    console.error("Failed to update mini photo:", error);
    res.status(500).json({ message: "Failed to update mini photo" });
  }
};
