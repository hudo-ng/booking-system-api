import { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import slugify from "slugify";
import { customAlphabet } from "nanoid";
import { sendSMS } from "../utils/sms";
import dayjs from "dayjs";
import axios from "axios";
import { normalizeName, normalizePhone } from "../utils/utils";

const prisma = new PrismaClient();

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
  if (!currentUser?.isOwner) {
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

export const getAllNotificationByAppointmentId = async (
  req: Request,
  res: Response,
) => {
  try {
    const { appointment_id } = req.query;

    if (!appointment_id || typeof appointment_id !== "string") {
      return res.status(400).json({ message: "appointment_id is required" });
    }

    const notifications = await prisma.notification.findMany({
      where: { appointment_id },
      orderBy: { created_at: "desc" },
      include: {
        createdBy: {
          select: { id: true, name: true },
        },
      },
    });

    res.json(notifications);
  } catch (err) {
    console.error("Error fetching notifications by appointment_id:", err);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
};
export const searchAllNotification = async (req: Request, res: Response) => {
  try {
    const { search } = req.query;

    if (!search || typeof search !== "string") {
      return res.status(400).json({ message: "Search parameter is required" });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        OR: [
          {
            title: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            customer_name: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            description: {
              contains: search,
              mode: "insensitive",
            },
          },
        ],
      },
      orderBy: { created_at: "desc" },
      take: 30,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    res.json(notifications);
  } catch (err) {
    console.error("Error searching notifications:", err);
    res.status(500).json({ message: "Failed to search notifications" });
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
  res: Response,
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

export const getSignInCustomers = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    const { start_date, end_date, is_customers } = req.query;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { isOwner: true },
    });

    if (!currentUser || !currentUser.isOwner) {
      return res.json({ success: true, data: [], array_of_form_bookings: [] });
    }

    let whereClause: any = {};
    if (start_date && end_date) {
      whereClause.createdAt = {
        gte: new Date(start_date as string),
        lte: new Date(end_date as string),
      };
    }

    // 1. Fetch initial data sets concurrently
    const [customers, formBookings] = await Promise.all([
      prisma.signInCustomer.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
      }),
      // If only customers are requested, skip loading booking records completely
      is_customers === "true"
        ? Promise.resolve([])
        : prisma.formBookingRequest.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
          }),
    ]);

    // 2. STAGE EARLY ESCAPE: If only customer list is targeted or no forms exist
    if (is_customers === "true" || formBookings.length === 0) {
      return res.json({
        success: true,
        data: customers,
        array_of_form_bookings: [],
        summaryAnalytics: {
          totalBookedAppointments: 0,
          totalFormBookingsProcessed: 0,
          conversionRatePercentage: 0,
          breakdowns: [],
        },
      });
    }

    // 3. Fall-through deep calculation logic (Executed only when is_customers != true)
    const emails = formBookings.map((b) => b.email).filter(Boolean);
    const rawPhones = formBookings.map((b) => b.phone).filter(Boolean);
    const names = formBookings.map((b) => b.name).filter(Boolean);

    const earliestFormDate = formBookings.reduce(
      (min, b) => (b.createdAt < min ? b.createdAt : min),
      formBookings[0].createdAt,
    );

    const matchConditions: any[] = [
      { email: { in: emails } },
      { phone: { in: rawPhones } },
      { customerName: { in: names } },
    ];

    names.forEach((name) => {
      const cleanName = normalizeName(name);
      if (cleanName && cleanName.length >= 3) {
        matchConditions.push({
          email: {
            contains: cleanName,
            mode: "insensitive",
          },
        });
      }
    });

    const prospectiveAppointments = await prisma.appointment.findMany({
      where: {
        createdAt: { gte: earliestFormDate },
        OR: matchConditions,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        customerName: true,
        createdAt: true,
        assignedBy: {
          select: {
            id: true,
            name: true,
            colour: true,
          },
        },
      },
    });

    const bookedAppointmentsTracked: any[] = [];

    const array_of_form_bookings = formBookings.map((booking) => {
      const bookingEmail = booking.email.toLowerCase().trim();
      const bookingPhoneCleaned = normalizePhone(booking.phone);
      const bookingNameCleaned = normalizeName(booking.name);

      const matchingApp = prospectiveAppointments.find((app) => {
        if (!app.createdAt || app.createdAt <= booking.createdAt) return false;

        const appEmail = app.email?.toLowerCase().trim() || "";
        const appPhoneCleaned = normalizePhone(app.phone);
        const appNameCleaned = normalizeName(app.customerName);

        const emailMatch = bookingEmail && appEmail === bookingEmail;
        const phoneMatch =
          bookingPhoneCleaned && appPhoneCleaned === bookingPhoneCleaned;
        const exactNameMatch =
          bookingNameCleaned && appNameCleaned === bookingNameCleaned;
        const nameInsideEmailMatch =
          bookingNameCleaned.length >= 3 &&
          appEmail.includes(bookingNameCleaned);

        return (
          emailMatch || phoneMatch || exactNameMatch || nameInsideEmailMatch
        );
      });

      if (matchingApp) {
        bookedAppointmentsTracked.push(matchingApp);
      }

      return {
        ...booking,
        hasAppointment: !!matchingApp,
        bookedBy: matchingApp?.assignedBy
          ? {
              id: matchingApp.assignedBy.id,
              name: matchingApp.assignedBy.name,
              colour: matchingApp.assignedBy.colour,
            }
          : matchingApp
            ? { name: "System/Unknown" }
            : null,
      };
    });

    const totalBookedCount = bookedAppointmentsTracked.length;
    const assigneeMap: {
      [key: string]: { count: number; name: string; colour: string | null };
    } = {};

    bookedAppointmentsTracked.forEach((app) => {
      const id = app.assignedBy?.id || "unassigned_or_system";
      const name = app.assignedBy?.name || "Online Booking";
      const colour = app.assignedBy?.colour || null;

      if (!assigneeMap[id]) {
        assigneeMap[id] = { count: 0, name, colour };
      }
      assigneeMap[id].count += 1;
    });

    const breakdowns = Object.entries(assigneeMap)
      .map(([id, data]) => {
        const percentage =
          totalBookedCount > 0
            ? parseFloat(((data.count / totalBookedCount) * 100).toFixed(2))
            : 0;

        return {
          userId: id === "unassigned_or_system" ? null : id,
          userName: data.name,
          userColour: data.colour,
          count: data.count,
          percentage: percentage,
        };
      })
      .sort((a, b) => b.count - a.count);

    return res.json({
      success: true,
      data: customers,
      array_of_form_bookings,
      summaryAnalytics: {
        totalBookedAppointments: totalBookedCount,
        totalFormBookingsProcessed: formBookings.length,
        conversionRatePercentage:
          formBookings.length > 0
            ? parseFloat(
                ((totalBookedCount / formBookings.length) * 100).toFixed(2),
              )
            : 0,
        breakdowns,
      },
    });
  } catch (error: any) {
    console.error("Get SignInCustomers error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getListOfBookedAppointmentsByFormId = async (
  req: Request,
  res: Response,
) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    const { id } = req.query as { id?: string };

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!id) {
      return res
        .status(400)
        .json({ error: "Booking ID is required (?id=...)" });
    }

    const booking = await prisma.formBookingRequest.findUnique({
      where: { id: id },
    });

    if (!booking) {
      return res.status(404).json({ error: "Form booking request not found" });
    }

    const bookingEmail = booking.email?.toLowerCase().trim() || "";
    const bookingPhoneCleaned = normalizePhone(booking.phone);
    const bookingNameCleaned = normalizeName(booking.name);

    // Completely aligned DB pre-sweep conditions mirroring the pipeline
    const matchConditions: any[] = [];

    if (booking.email) {
      matchConditions.push({ email: booking.email });
    }
    if (booking.phone) {
      matchConditions.push({ phone: booking.phone });
    }
    if (booking.name) {
      matchConditions.push({
        customerName: {
          equals: booking.name.trim(),
          mode: "insensitive",
        },
      });
    }

    if (bookingNameCleaned && bookingNameCleaned.length >= 3) {
      matchConditions.push({
        email: {
          contains: bookingNameCleaned,
          mode: "insensitive",
        },
      });
    }

    // Safeguard condition if the booking object has completely empty search parameters
    if (matchConditions.length === 0) {
      return res.json({
        success: true,
        booking_info: {
          name: booking.name,
          email: booking.email,
          phone: booking.phone,
          requested_at: booking.createdAt,
        },
        data: [],
      });
    }

    const prospectiveAppointments = await prisma.appointment.findMany({
      where: {
        createdAt: {
          gt: booking.createdAt, // Aligns perfectly with pipeline evaluation
        },
        OR: matchConditions,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        employee: {
          select: { id: true, name: true, colour: true },
        },
        assignedBy: {
          select: { id: true, name: true, colour: true },
        },
      },
    });

    // Mirroring strict match logic evaluation
    const filteredAppointments = prospectiveAppointments.filter((app) => {
      // Duplicated conditional break out logic from getSignInCustomers pipeline
      if (!app.createdAt || app.createdAt <= booking.createdAt) return false;

      const appEmail = app.email?.toLowerCase().trim() || "";
      const appPhoneCleaned = normalizePhone(app.phone);
      const appNameCleaned = normalizeName(app.customerName);

      const emailMatch = bookingEmail && appEmail === bookingEmail;
      const phoneMatch =
        bookingPhoneCleaned && appPhoneCleaned === bookingPhoneCleaned;
      const exactNameMatch =
        bookingNameCleaned && appNameCleaned === bookingNameCleaned;
      const nameInsideEmailMatch =
        bookingNameCleaned.length >= 3 && appEmail.includes(bookingNameCleaned);

      return emailMatch || phoneMatch || exactNameMatch || nameInsideEmailMatch;
    });

    return res.json({
      success: true,
      booking_info: {
        name: booking.name,
        email: booking.email,
        phone: booking.phone,
        requested_at: booking.createdAt,
      },
      data: filteredAppointments,
    });
  } catch (error: any) {
    console.error("Get Booked Appointments error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const requestTattooArtistPaymentByUserId = async (
  req: Request,
  res: Response,
) => {
  try {
    const { user_id, start_date, end_date } = req.body;

    if (!user_id || !start_date || !end_date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1. Fetch Artist Details
    const user = await prisma.user.findUnique({
      where: { id: user_id },
    });

    if (!user) {
      return res.status(404).json({ error: "Artist not found" });
    }

    const artistName = user.name;
    const commRate = 0.55; // Standard commission from your example

    // 2. Get Booked Appointment IDs for Booking Fee logic (0.5%)
    const bookedAppointments = await prisma.appointment.findMany({
      where: {
        assignedById: {
          in: [
            "6a0c3e58-d4e4-4f32-8585-9fbb81b08417",
            "bab24c5b-ec93-4386-bdfb-7b0e1f25eb7f",
            "317b8640-2920-4d1d-853f-c8552545e634",
          ],
        },
      },
      select: { id: true },
    });
    const bookedIds = bookedAppointments.map((a) => a.id);

    // 3. Setup Date Loop
    const fromDate = dayjs(start_date);
    const toDate = dayjs(end_date);
    const dailyLogs: any[] = [];
    const bookingFeeDetails: any[] = [];

    let cursor = fromDate;

    // 4. Fetch and Process Data
    while (cursor.isBefore(toDate) || cursor.isSame(toDate, "day")) {
      const formattedDate = cursor.format("MMDDYYYY");

      try {
        // Fetch from External API
        const response = await axios.post(
          "https://hyperinkersform.com/api/fetching",
          { endDate: formattedDate },
        );

        const items = response.data?.data || [];

        // Filter for this specific artist
        const artistItems = items.filter(
          (i: any) =>
            i.artist?.toLowerCase() === artistName.toLowerCase() &&
            (i.status?.toLowerCase() === "paid" ||
              i.status?.toLowerCase() === "done"),
        );

        let dayPaidMoney = 0;
        let dayDeposit = 0;
        let dayTips = 0;

        artistItems.forEach((i: any) => {
          const paid = parseFloat(i?.paid_money) || 0;
          const deposit =
            i?.deposit_has_been_used === false
              ? 0
              : parseFloat(i?.deposit) || 0;
          const tip = parseFloat(i?.tip) || 0;
          const volume = paid + deposit;

          dayPaidMoney += paid;
          dayDeposit += deposit;
          dayTips += tip;

          // Check for Booking Fee (0.5%)
          if (bookedIds.includes(i.appointment_id)) {
            bookingFeeDetails.push({
              date: cursor.format("MMM DD, YYYY"),
              customer: `${i?.firstName} ${i?.lastName}`,
              volume: volume,
              fee: volume * 0.005,
            });
          }
        });

        const dailyComm = (dayPaidMoney + dayDeposit) * commRate;

        dailyLogs.push({
          date: cursor.format("MMM DD, YYYY"),
          paidMoney: dayPaidMoney,
          deposit: dayDeposit,
          commission: dailyComm,
          tips: dayTips,
          subtotal: dailyComm + dayTips,
        });
      } catch (err) {
        console.error(`Error fetching for ${formattedDate}`);
      }

      // Add a small delay to prevent rate limiting during the loop
      await delay(200);
      cursor = cursor.add(1, "day");
    }

    // 5. Calculate Totals
    const totalVolume = dailyLogs.reduce(
      (acc, d) => acc + d.paidMoney + d.deposit,
      0,
    );
    const totalTips = dailyLogs.reduce((acc, d) => acc + d.tips, 0);
    const totalCommission = totalVolume * commRate;
    const totalBookingFees = bookingFeeDetails.reduce(
      (acc, f) => acc + f.fee,
      0,
    );
    const netPay = totalCommission + totalTips - totalBookingFees;

    // 6. Return Data for Client-Side Rendering
    return res.json({
      success: true,
      artist: {
        id: user.id,
        name: artistName,
        email: user.email,
        commRate: commRate,
      },
      period: {
        start: start_date,
        end: end_date,
        formatted: `${fromDate.format("MMM DD")} - ${toDate.format("MMM DD, YYYY")}`,
      },
      stats: {
        totalVolume,
        totalTips,
        totalCommission,
        totalBookingFees,
        netPay,
        totalWorkDays: dailyLogs.filter((d) => d.paidMoney > 0 || d.deposit > 0)
          .length,
      },
      dailyLogs,
      bookingFeeDetails,
    });
  } catch (error: any) {
    console.error("Payment Request Error:", error);
    return res.status(500).json({ error: error.message });
  }
};

export const getAllEmployees = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Get current user status
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { isOwner: true, isAdmin: true },
  });

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  let employees;

  // Full selection configuration including all database fields
  const completeUserSelection = {
    id: true,
    email: true,
    name: true,
    role: true,
    position: true,
    createdAt: true,
    colour: true,
    isAdmin: true,
    isOwner: true,
    percentage_clean: true,
    percentage_shared: true,
    percentage_work: true,
    phone_number: true,
    photo_url: true,
    show_on_calendar_booking: true,
    slug: true,
    start_price: true,
    wage: true,
    new_wage: true,
    bonus_wage: true,
    extra_hour_wage: true,
    sale_content_bonus: true,
    is_reception: true,
    is_piercing: true,
    currentDeviceId: true,
  };

  // Owners and Admins see the full list
  if (currentUser?.isOwner || currentUser?.isAdmin) {
    employees = await prisma.user.findMany({
      where: { deletedAt: null }, // Adjusted to get all employees safely
      select: completeUserSelection,
    });
  } else {
    // Standard employees only see themselves
    const employee = await prisma.user.findUnique({
      where: { id: userId },
      select: completeUserSelection,
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

  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  if (!currentUser?.isOwner) {
    return res.status(403).json({ error: "You do not have permission" });
  }

  const { staff_id, ...updatePayload } = req.body;

  if (!staff_id) {
    return res.status(400).json({ error: "Target staff_id is required" });
  }

  try {
    // Construct data dynamically to update whatever fields the user wants
    const updateData: any = {};

    const possibleFields = [
      "name",
      "email",
      "phone_number",
      "start_price",
      "colour",
      "photo_url",
      "percentage_clean",
      "percentage_work",
      "percentage_shared",
      "show_on_calendar_booking",
      "is_reception",
      "is_piercing",
      "position",
      "wage",
      "new_wage",
      "bonus_wage",
      "extra_hour_wage",
      "sale_content_bonus",
      "isAdmin",
    ];

    possibleFields.forEach((field) => {
      if (updatePayload[field] !== undefined) {
        updateData[field] = updatePayload[field];
      }
    });

    const updatedEmployee = await prisma.user.update({
      where: { id: staff_id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        position: true,
        colour: true,
        isAdmin: true,
        isOwner: true,
        percentage_clean: true,
        percentage_shared: true,
        percentage_work: true,
        phone_number: true,
        photo_url: true,
        show_on_calendar_booking: true,
        slug: true,
        start_price: true,
        wage: true,
        new_wage: true,
        bonus_wage: true,
        extra_hour_wage: true,
        sale_content_bonus: true,
        is_reception: true,
        is_piercing: true,
      },
    });

    res.json(updatedEmployee);
  } catch (error) {
    console.error("Failed to update employee:", error);
    res.status(500).json({ message: "Failed to update employee" });
  }
};

export const addEmployee = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!currentUser?.isAdmin && !currentUser?.isOwner) {
      return res.status(403).json({ error: "You do not have permission" });
    }

    const { email, password, name, ...optionalFields } = req.body;

    // Strict validation only on critical creation properties
    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ error: "Email, password, and name are required parameters." });
    }

    const hashed = await bcrypt.hash(password, 10);
    const nano = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 5);
    const base =
      slugify(name || "user", { lower: true, strict: true }) || "user";
    const slug = `${base}-${nano()}`;

    // Safely structure creation data using explicit fallbacks or incoming requests values
    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name,
        slug,
        role: "employee",
        colour:
          optionalFields.colour !== undefined ? optionalFields.colour : null,
        start_price:
          optionalFields.start_price !== undefined
            ? optionalFields.start_price
            : null,
        isAdmin: !!optionalFields.isAdmin,
        phone_number:
          optionalFields.phone_number !== undefined
            ? optionalFields.phone_number
            : "111-111-1111",
        position:
          optionalFields.position !== undefined
            ? optionalFields.position
            : "general",
        wage: optionalFields.wage !== undefined ? optionalFields.wage : 0,
        new_wage:
          optionalFields.new_wage !== undefined ? optionalFields.new_wage : 0,
        bonus_wage:
          optionalFields.bonus_wage !== undefined
            ? optionalFields.bonus_wage
            : 0,
        extra_hour_wage:
          optionalFields.extra_hour_wage !== undefined
            ? optionalFields.extra_hour_wage
            : 0,
        sale_content_bonus:
          optionalFields.sale_content_bonus !== undefined
            ? optionalFields.sale_content_bonus
            : 0,
        percentage_clean:
          optionalFields.percentage_clean !== undefined
            ? optionalFields.percentage_clean
            : 0,
        percentage_shared:
          optionalFields.percentage_shared !== undefined
            ? optionalFields.percentage_shared
            : 0,
        percentage_work:
          optionalFields.percentage_work !== undefined
            ? optionalFields.percentage_work
            : 0,
        show_on_calendar_booking: !!optionalFields.show_on_calendar_booking,
        is_reception: !!optionalFields.is_reception,
        is_piercing: !!optionalFields.is_piercing,
        photo_url:
          optionalFields.photo_url !== undefined
            ? optionalFields.photo_url
            : null,
      },
    });

    return res.status(201).json({
      id: user.id,
      email: user.email,
      role: user.role,
      position: user.position,
    });
  } catch (error) {
    console.error("Error creating employee:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Helper function to securely load terminal credentials based on explicit device selections.
 */
const getTerminalCredentials = (deviceNumber: string) => {
  if (deviceNumber === "terminal_2") {
    return {
      Tpn: process.env.DEJAVOO_TPN_SECOND,
      Authkey: process.env.DEJAVOO_AUTH_KEY_SECOND,
      RegisterId: process.env.DEJAVOO_REGISTER_ID_SECOND,
      MerchantNumber: process.env.DEJAVOO_MERCHANT_NUMBER!,
    };
  }
  // Default fallback or explicit terminal_1 routing
  return {
    Tpn: process.env.DEJAVOO_TPN,
    Authkey: process.env.DEJAVOO_AUTH_KEY,
    RegisterId: process.env.DEJAVOO_REGISTER_ID,
    MerchantNumber: process.env.DEJAVOO_MERCHANT_NUMBER!,
  };
};

export const getPaidPayments = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) return res.status(404).json({ error: "User not found" });

    // STRICT OWNER CHECK
    if (currentUser.isOwner !== true) {
      return res.status(403).json({ error: "Access denied. Owners only." });
    }

    // Extract query parameters from request
    const { search_key } = req.query;

    // Define baseline filtering rules: Must be terminal-approved OR a cash variant
    const baseWhereClause: any = {
      OR: [{ statusCode: "0000" }],
    };

    // Advanced search logic capturing both standard data and sensitive identifiers
    if (
      search_key &&
      typeof search_key === "string" &&
      search_key.trim() !== ""
    ) {
      const parsedSearch = search_key.trim();

      baseWhereClause.AND = [
        {
          OR: [
            // Standard customer identifier search
            { customer_name: { contains: parsedSearch, mode: "insensitive" } },
          ],
        },
      ];
    }

    // Execute query with a safety cap returning only the latest 200 items
    const paidPayments = await prisma.trackingPayment.findMany({
      where: baseWhereClause,
      orderBy: { createdAt: "desc" },
      take: 200, // Forces performance optimization limit
    });

    return res.json({ success: true, data: paidPayments });
  } catch (err: any) {
    console.error("Error fetching paid payments:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const voidPaymentRequest = async (req: Request, res: Response) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) return res.status(404).json({ error: "User not found" });

    if (currentUser.isOwner !== true) {
      return res
        .status(403)
        .json({ error: "Access denied. Only owners can void transactions." });
    }

    const { tracking_payment_id, device_number, extra_data } = req.body;
    if (!tracking_payment_id) {
      return res
        .status(400)
        .json({ success: false, error: "tracking_payment_id is required." });
    }

    const originalPayment = await prisma.trackingPayment.findUnique({
      where: { id: tracking_payment_id },
    });

    if (!originalPayment) {
      return res
        .status(404)
        .json({ success: false, error: "Payment record not found." });
    }

    if (originalPayment.voided) {
      return res
        .status(400)
        .json({ success: false, error: "This transaction is already voided." });
    }

    // --- CASH/CASHAPP BYPASS ---
    if (
      originalPayment.paymentType === "Cash" ||
      originalPayment.paymentType === "CashApp"
    ) {
      const updatedCashRecord = await prisma.trackingPayment.update({
        where: { id: tracking_payment_id },
        data: { voided: true, transactionType: "VoidedPayment" },
      });
      await reverseExternalFormPayment(originalPayment, extra_data);
      return res.json({
        success: true,
        message: "Cash voided internally.",
        record: updatedCashRecord,
      });
    }

    // --- CARD VOID OPERATION ---
    const targetDevice =
      device_number || originalPayment.device_number || "terminal_1";
    const { Tpn, Authkey, RegisterId } = getTerminalCredentials(targetDevice);

    if (!Tpn || !Authkey) {
      return res.status(500).json({
        success: false,
        error: `Missing essential terminal config (Tpn/Authkey) for identifier: ${targetDevice}`,
      });
    }

    // ==========================================
    // CRITICAL DEJAVOO ID ALIGNMENT DEBUGS
    // ==========================================
    console.log("=== [DEJAVOO DEEP TELEMETRY START] ===");
    console.log("[DB VALUES FOUND]:", {
      pnReferenceId: originalPayment.pnReferenceId, // Primary Dejavoo Transaction ID
      transactionNumber: originalPayment.transactionNumber, // Sequential identifier in batch
      referenceId: originalPayment.referenceId, // App POS unique reference
      totalAmount: originalPayment.totalAmount, // Amount + Surcharge processing fee
      amount: originalPayment.amount, // Pure base price
    });

    const payload = {
      Tpn: Tpn.trim(),
      Authkey: Authkey.trim(),
      RegisterId: RegisterId ? RegisterId.trim() : "",
      MerchantNumber: null,
      PaymentType: "Credit",

      // FIX 1: Omit your custom application reference string ("V_028") so Dejavoo's
      // routing router doesn't pull a false match on fallback digits.
      ReferenceId: originalPayment.referenceId,

      // FIX 2: Explicitly target the immutable gateway payment reference token
      PNReferenceId: originalPayment.pnReferenceId || undefined,
      TransactionNumber: originalPayment.transactionNumber || undefined,

      // Match the exact processing authorization amount string ($1.03)
      Amount: originalPayment.totalAmount || originalPayment.amount,

      PrintReceipt: "No",
      GetReceipt: "No",
      CaptureSignature: false,
      GetExtendedData: true,
      IsReadyForIS: false,
    };

    console.log(
      "[OUTBOUND PAYLOAD TO SPINPOS]:",
      JSON.stringify(payload, null, 2),
    );
    console.log("=== [DEJAVOO DEEP TELEMETRY END] ===");

    const response = await axios.post(
      "https://spinpos.net/v2/Payment/Void",
      payload,
      { headers: { "Content-Type": "application/json" }, timeout: 240000 },
    );

    const dejavooResult = response.data;

    console.log(
      "[RAW INBOUND API RESPONSE]:",
      JSON.stringify(dejavooResult, null, 2),
    );

    if (dejavooResult?.GeneralResponse?.StatusCode !== "0000") {
      return res.status(422).json({
        success: false,
        error:
          dejavooResult?.GeneralResponse?.Message ||
          "Terminal rejected void execution.",
        detailedMessage: dejavooResult?.GeneralResponse?.DetailedMessage,
        dejavoo: dejavooResult,
      });
    }

    const updatedCardRecord = await prisma.trackingPayment.update({
      where: { id: tracking_payment_id },
      data: {
        voided: true,
        transactionType: dejavooResult?.TransactionType ?? "VoidedCardPayment",
        statusCode: dejavooResult?.GeneralResponse?.StatusCode,
        message: dejavooResult?.GeneralResponse?.Message,
        detailedMessage: dejavooResult?.GeneralResponse?.DetailedMessage,
        device_number: targetDevice,
      },
    });

    await reverseExternalFormPayment(originalPayment, extra_data);

    return res.json({
      success: true,
      message: "Card transaction voided successfully.",
      dejavoo: dejavooResult,
      cardRecord: updatedCardRecord,
    });
  } catch (err: any) {
    console.error("=== [VOID EXCEPTION TELEMETRY] ===");
    if (err.response) {
      console.error("Status Code Received:", err.response.status);
      console.error(
        "Payload Trace Body:",
        JSON.stringify(err.response.data, null, 2),
      );
    } else {
      console.error("System Runtime Error Message:", err.message);
    }
    return res
      .status(500)
      .json({ success: false, error: err.response?.data || err.message });
  }
};
/**
 * Secondary downstream webhook helper synchronization module
 */
export const reverseExternalFormPayment = async (
  originalPayment: any,
  extra_data: any,
) => {
  try {
    // 1. Identify the structural parameters
    const documentId = extra_data?.documentId || originalPayment.document_id;
    const realtimeDbId = extra_data?.id || originalPayment.document_id;
    const collectionId =
      extra_data?.collectionId || originalPayment.item_service;

    // 2. Determine if it's a piercing or tattoo based on the artist
    const piercingArtists = ["nicole", "yen", "zoe", "others"];
    const artistName = (originalPayment.artist || "").toLowerCase().trim();

    const isPiercing =
      piercingArtists.includes(artistName) || collectionId === "piercing";

    // 3. Dynamic endpoint routing selector
    const segment = isPiercing ? "piercing" : "tattoo";
    const webhookUrl = `https://hyperinkersform.com/api/${segment}/payment`;

    if (!documentId || !collectionId || !realtimeDbId) {
      console.error("[WEBHOOK ERROR] Blocked: Missing critical identifiers.", {
        documentId,
        collectionId,
        realtimeDbId,
      });
      return;
    }

    const payload = {
      tracking_payment_id: originalPayment.id,
      status: "voided", // Telling Next.js this transaction is getting canceled
      paid_money: 0,
      documentId,
      collectionId,
      id: realtimeDbId,
    };

    console.log(
      `[WEBHOOK SYNC] Routing data reversal to [${segment.toUpperCase()}] target: ${webhookUrl}`,
    );

    const response = await axios.patch(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
    });

    console.log("[WEBHOOK SYNC SUCCESS]:", response.data);
    return response.data;
  } catch (err: any) {
    console.error(
      "Failed downstream webhook data sync reversal:",
      err.response?.data || err.message,
    );
    throw err;
  }
};
