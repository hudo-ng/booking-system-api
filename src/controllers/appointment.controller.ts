import { Request, Response } from "express";
import { PrismaClient, AppointmentStatus } from "@prisma/client";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { generateOccurrences } from "../utils/generateOccurrences";

const prisma = new PrismaClient();
dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "America/Chicago";
export const getAppointments = async (req: Request, res: Response) => {
  const { userId, role } = (req as any).user as {
    userId: string;
    role: string;
  };
  const roleToSearch = role === "employee" ? { employeeId: userId } : {};
  const appointments = await prisma.appointment.findMany({
    where: roleToSearch,
    orderBy: { createdAt: "desc" },
    include: {
      employee: {
        select: { id: true, name: true },
      },
    },
  });
  res.json(appointments);
};

export const createAppointment = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  if (!userId) {
    return res.json([]);
  }

  try {
    const {
      employeeId,
      customerName,
      email,
      phone,
      detail,
      startTime,
      endTime,
      // ✅ New fields for Notification
      quote_amount,
      deposit_amount,
      deposit_category,
      extra_deposit_category,
      assignedById,
    } = req.body;

    // ✅ Validate time order
    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);

      if (end <= start) {
        return res.status(400).json({
          message: "End time must be after start time",
        });
      }
    }

    // ✅ Create Appointment
    const newAppointment = await prisma.appointment.create({
      data: {
        employeeId: employeeId ? employeeId : userId,
        assignedById: assignedById ?? userId,
        customerName,
        email,
        phone,
        detail,
        status: "accepted",
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        quote_amount,
        deposit_amount,
        deposit_category,
        extra_deposit_category,
      },
      include: {
        employee: {
          select: { id: true, name: true },
        },
      },
    });

    // ✅ Create Notification after successful appointment
    await prisma.notification.create({
      data: {
        created_by: userId,
        description: detail ? detail : "No description provided",
        title: "created new appointment",
        customer_name: customerName ? customerName : "No name provided",
        quote_amount,
        deposit_amount,
        deposit_category,
        extra_deposit_category,
        appointment_start_time: startTime ? new Date(startTime) : new Date(),
        appointment_end_time: endTime ? new Date(endTime) : new Date(),
      },
    });

    res.status(201).json(newAppointment);
  } catch (error) {
    console.error("Failed to create appointment", error);
    res.status(500).json({ message: "Failed to create appointment" });
  }
};

export const editAppointment = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const {
      id,
      employeeId,
      customerName,
      email,
      phone,
      detail,
      startTime,
      endTime,
      quote_amount,
      deposit_amount,
      deposit_category,
      extra_deposit_category,
    } = req.body;
    console.log("Editing appointment with ID:", id);
    // ✅ Validate time order
    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);
      if (end <= start) {
        return res
          .status(400)
          .json({ message: "End time must be after start time" });
      }
    }

    // ✅ Update Appointment

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        employeeId,
        customerName,
        email,
        phone,
        detail,
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        quote_amount,
        deposit_amount,
        deposit_category,
        extra_deposit_category,
      },
      include: {
        employee: { select: { id: true, name: true } },
      },
    });
    if (updated) {
      // ✅ Optional: Log edit as notification
      await prisma.notification.create({
        data: {
          created_by: userId,
          description: detail ? detail : "No description provided",
          title: "edit appointment",
          customer_name: customerName ? customerName : "No name provided",
          quote_amount,
          deposit_amount,
          deposit_category,
          extra_deposit_category,
          appointment_start_time: startTime ? new Date(startTime) : new Date(),
          appointment_end_time: endTime ? new Date(endTime) : new Date(),
        },
      });

      res.json(updated);
    } else {
      return res
        .status(400)
        .json({ message: "End time must be after start time" });
    }
  } catch (error) {
    console.error("❌ Failed to edit appointment:", error);
    res.status(500).json({ message: "Failed to edit appointment" });
  }
};

export const getAllAppointments = async (req: Request, res: Response) => {
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

  const { year, month } = req.query as { year?: string; month?: string };

  let dateFilter = {};

  if (year && month) {
    // Convert query params to integers
    const y = parseInt(year, 10);
    const m = parseInt(month, 10); // 1-based month

    const startOfMonth = dayjs(`${y}-${m}-01`).startOf("month").toDate();
    const endOfMonth = dayjs(`${y}-${m}-01`).endOf("month").toDate();

    // If you want appointments overlapping the month:
    dateFilter = {
      AND: [
        { startTime: { lte: endOfMonth } },
        { endTime: { gte: startOfMonth } },
      ],
    };
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      ...dateFilter,
    },
    orderBy: { createdAt: "desc" },
    include: {
      employee: {
        select: { id: true, name: true, colour: true },
      },
    },
  });

  res.json(appointments);
};

export const getCountAppointmentPending = async (
  req: Request,
  res: Response
) => {
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
  let count = 0;

  if (currentUser.isAdmin) {
    count = await prisma.appointment.count({
      where: {
        status: "pending",
      },
    });
  } else {
    count = await prisma.appointment.count({
      where: {
        employeeId: userId,
        status: "pending",
      },
    });
  }
  res.json(count);
};

export const deleteAppointment = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  const { appointmentId } = req.query as { appointmentId?: string };
  console.log("Deleting appointment with ID:", appointmentId);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!appointmentId)
    return res.status(400).json({ message: "Appointment ID required" });

  try {
    // Delete appointment
    const deletedAppointment = await prisma.appointment.delete({
      where: { id: appointmentId },
      include: { employee: { select: { id: true, name: true } } },
    });

    // Create notification for deletion
    await prisma.notification.create({
      data: {
        created_by: userId,

        title: "Delete Appointment",
        description: deletedAppointment.detail || "Appointment deleted",
        customer_name: deletedAppointment.customerName,
        quote_amount: deletedAppointment?.quote_amount || 0,
        deposit_amount: deletedAppointment?.deposit_amount || 0,
        deposit_category: deletedAppointment?.deposit_category || "",
        extra_deposit_category: deletedAppointment.extra_deposit_category || "",
        appointment_start_time: deletedAppointment.startTime || new Date(),
        appointment_end_time: deletedAppointment.endTime || new Date(),
      },
    });

    res.status(200).json({
      message: "Appointment deleted",
      appointment: deletedAppointment,
    });
  } catch (error) {
    console.error("Failed to delete appointment", error);
    res.status(500).json({ message: "Failed to delete appointment" });
  }
};

export const getAllAppointmentsBySelectedDate = async (
  req: Request,
  res: Response
) => {
  try {
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Query current user
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const { date } = req.query as { date?: string };
    if (!date) {
      return res
        .status(400)
        .json({ error: "Query parameter 'date' is required" });
    }

    // ✅ Convert using San Antonio timezone (America/Chicago)
    const startOfDay = dayjs.tz(date, TIMEZONE).startOf("day").utc().toDate();
    const endOfDay = dayjs.tz(date, TIMEZONE).endOf("day").utc().toDate();

    // Optional: Log for debugging in production
    console.log({
      date,
      startOfDay: startOfDay.toISOString(),
      endOfDay: endOfDay.toISOString(),
    });

    const appointments = await prisma.appointment.findMany({
      where: {
        startTime: { lte: endOfDay },
        endTime: { gte: startOfDay },
      },
      orderBy: { startTime: "asc" },
      include: {
        employee: {
          select: { id: true, name: true, colour: true },
        },
      },
    });

    return res.json(appointments);
  } catch (err) {
    console.error("Error fetching appointments:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getAppointmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // appointment ID from URL param

    if (!id) {
      return res.status(400).json({ message: "Appointment ID is required" });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        employee: {
          select: { id: true, name: true },
        },
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    return res.json(appointment);
  } catch (error) {
    console.error("getAppointmentById error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateAppointmentStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, startTime, endTime } = req.body as {
    status: AppointmentStatus;
    startTime?: string;
    endTime?: string;
  };
  const { userId, role } = (req as any).user as {
    userId: string;
    role: string;
  };
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) return res.status(403).json({ message: "Not found" });
  if (role === "employee" && appt.employeeId !== userId) return res.status(403);
  const data: any = { status };
  if (status === "accepted") {
    data.startTime = new Date(startTime!);
    data.endTime = new Date(endTime!);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  if (!user) throw new Error("User not found");
  const changedBy = user.name;
  // await trackAppointmentHistory(
  //   id,
  //   appt,
  //   { startTime, endTime, status },
  //   changedBy
  // );

  const updated = await prisma.appointment.update({
    where: { id },
    data,
  });
  res.json(updated);
};

export const updateAppointment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { startTime, endTime, status } = req.body;

  const { userId, role } = (req as any).user as {
    userId: string;
    role: string;
  };

  if (!startTime || !endTime) {
    return res.status(400).json({ message: "Start and end time required." });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment)
    return res.status(404).json({ message: "Appointment not found." });

  const employeeId = appointment.employeeId;
  const newStart = new Date(startTime);
  const newEnd = new Date(endTime);

  // Conflict check for accepted appointments
  const conflict = await prisma.appointment.findFirst({
    where: {
      id: { not: id },
      employeeId,
      status: "accepted",
      startTime: { lt: newEnd },
      endTime: { gt: newStart },
    },
  });

  if (conflict) {
    return res.status(400).json({
      message: "This time overlaps with another accepted appointment.",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  if (!user) throw new Error("User not found");
  const changedBy = user.name;
  // await trackAppointmentHistory(
  //   id,
  //   appointment,
  //   { startTime, endTime, status },
  //   changedBy
  // );

  try {
    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        startTime: newStart,
        endTime: newEnd,
        status,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error("Update failed", err);
    res.status(500).json({ message: "Failed to update appointment" });
  }
};

export const updateCompletedPhotoUrlAppointmentById = async (
  req: Request,
  res: Response
) => {
  const { id, completedPhotoUrl } = req.body;
  console.log("Updating appointment ID:", id);
  console.log("New completedPhotoUrl:", completedPhotoUrl);
  if (!completedPhotoUrl) {
    return res.status(400).json({ message: "completedPhotoUrl is required." });
  }

  try {
    const appointment = await prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found." });
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: { completed_photo_url: completedPhotoUrl },
    });

    res.json({
      message: "Appointment photo updated successfully.",
      appointment: updated,
    });
  } catch (err) {
    console.error("Error updating appointment photo URL:", err);
    res.status(500).json({ message: "Failed to update appointment photo." });
  }
};

export const getAppointmentHistory = async (req: Request, res: Response) => {
  const { id: appointmentId } = req.params;
  try {
    const history = await prisma.appointmentHistory.findMany({
      where: { appointmentId },
      orderBy: { changedAt: "desc" },
    });
    res.json(history);
  } catch (err) {
    console.error("Failed to fetch appointment history:", err);
    res.status(500).json({ message: "Failed to fetch appointment history" });
  }
};

export const createRecurringAppointments = async (
  req: Request,
  res: Response
) => {
  const { userId } = (req as any).user as { userId?: string };
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const {
      employeeId,
      customerName,
      email,
      phone,
      detail,
      startDate,
      startTime,
      endTime,
      frequency,
      interval = 1,
      count,
      endDate,
      byWeekday,
      quote_amount,
      deposit_amount,
      deposit_category,
      extra_deposit_category,
    } = req.body;

    const series = await prisma.recurringSeries.create({
      data: {
        employeeId: employeeId ?? userId,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        frequency,
        interval,
        count,
        byWeekday,
      },
    });

    const occurrences = generateOccurrences(
      series,
      startTime,
      endTime,
      "America/Chicago"
    );

    const validOccurrences: { start: Date; end: Date }[] = [];
    for (const occ of occurrences) {
      const conflict = await prisma.appointment.findFirst({
        where: {
          employeeId,
          status: "accepted",
          startTime: { lt: occ.end },
          endTime: { gt: occ.start },
        },
      });
      if (!conflict) validOccurrences.push(occ);
    }

    const createdAppointments = await prisma.$transaction(async (tx) => {
      return await Promise.all(
        validOccurrences.map((occ, index) =>
          tx.appointment.create({
            data: {
              employeeId: employeeId ?? userId,
              customerName,
              email,
              phone,
              detail,
              status: "accepted",
              startTime: occ.start,
              endTime: occ.end,
              quote_amount,
              deposit_amount,
              deposit_category,
              extra_deposit_category,
              seriesId: series.id,
              occurrenceIndex: index + 1,
            },
          })
        )
      );
    });

    await prisma.notification.create({
      data: {
        created_by: userId,
        title: "Created recurring appointments",
        description: `Recurring (${frequency}) appointments for ${customerName}`,
        customer_name: customerName || "No name provided",
        quote_amount,
        deposit_amount,
        deposit_category,
        extra_deposit_category,
        appointment_start_time: new Date(startDate),
        appointment_end_time: new Date(startDate),
      },
    });

    res.status(201).json({
      message: "Recurring appointments created",
      seriesId: series.id,
      createdCount: createdAppointments.length,
      skippedCount: occurrences.length - validOccurrences.length,
    });
  } catch (error) {
    console.error("Failed to create recurring appointments:", error);
    res
      .status(500)
      .json({ message: "Failed to create recurring appointments" });
  }
};

export const editRecurringAppointments = async (
  req: Request,
  res: Response
) => {
  const { seriesId } = req.params;
  const { updateAll } = req.query;
  const { userId } = (req as any).user as { userId: string };

  const {
    customerName,
    detail,
    startTime,
    endTime,
    frequency,
    interval,
    count,
    byWeekday,
  } = req.body;

  try {
    const series = await prisma.recurringSeries.findUnique({
      where: { id: seriesId },
      include: {
        employee: { select: { id: true, name: true } },
        appointments: true,
      },
    });

    if (!series) return res.status(404).json({ message: "Series not found" });

    const sampleAppt = series.appointments[0];
    const custName = customerName ?? sampleAppt?.customerName ?? "Unknown";

    if (updateAll === "true") {
      await prisma.recurringSeries.update({
        where: { id: seriesId },
        data: { frequency, interval, count, byWeekday },
      });
    }

    const targets =
      updateAll === "true" ? series.appointments : [series.appointments[0]];

    for (const appt of targets) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: {
          customerName: customerName ?? appt.customerName,
          detail: detail ?? appt.detail,
          startTime: startTime ? new Date(startTime) : appt.startTime,
          endTime: endTime ? new Date(endTime) : appt.endTime,
          isException: updateAll !== "true",
        },
      });
    }

    await prisma.notification.create({
      data: {
        created_by: userId,
        title:
          updateAll === "true"
            ? "Recurring Series Updated"
            : "Appointment Updated",
        description:
          updateAll === "true"
            ? `All appointments for ${custName} were updated.`
            : `${custName}'s single appointment was updated.`,
        customer_name: custName,
        quote_amount: sampleAppt?.quote_amount ?? 0,
        deposit_amount: sampleAppt?.deposit_amount ?? 0,
        deposit_category: sampleAppt?.deposit_category ?? "",
        extra_deposit_category: sampleAppt?.extra_deposit_category ?? "",
        appointment_start_time: sampleAppt?.startTime ?? new Date(),
        appointment_end_time: sampleAppt?.endTime ?? new Date(),
      },
    });

    return res.json({
      message: `Updated ${targets.length} appointment(s)`,
    });
  } catch (error) {
    console.error("❌ editRecurringAppointments error:", error);
    res
      .status(500)
      .json({ message: "Failed to update recurring appointments" });
  }
};

export const deleteRecurringAppointments = async (
  req: Request,
  res: Response
) => {
  const { seriesId } = req.params;
  const { deleteAll } = req.query;
  const { userId } = (req as any).user as { userId: string };

  try {
    const series = await prisma.recurringSeries.findUnique({
      where: { id: seriesId },
      include: {
        employee: { select: { id: true, name: true } },
        appointments: true,
      },
    });

    if (!series) {
      return res.status(404).json({ message: "Series not found" });
    }
    const sampleAppt = series.appointments[0];
    const customerName = sampleAppt?.customerName || "Unknown customer";

    if (deleteAll === "true") {
      await prisma.$transaction(async (tx) => {
        await tx.appointment.deleteMany({ where: { seriesId } });
        await tx.recurringSeries.update({
          where: { id: seriesId },
          data: { isActive: false },
        });
      });

      await prisma.notification.create({
        data: {
          created_by: userId,
          title: "Recurring Series Deleted",
          description: `All appointments for ${customerName} were deleted.`,
          customer_name: customerName,
          quote_amount: sampleAppt?.quote_amount ?? 0,
          deposit_amount: sampleAppt?.deposit_amount ?? 0,
          deposit_category: sampleAppt?.deposit_category ?? "",
          extra_deposit_category: sampleAppt?.extra_deposit_category ?? "",
          appointment_start_time: sampleAppt?.startTime ?? new Date(),
          appointment_end_time: sampleAppt?.endTime ?? new Date(),
        },
      });

      return res.json({
        message: "Recurring series deactivated and appointments deleted",
      });
    }

    const upcoming = series.appointments
      .filter((a) => a.startTime && dayjs(a.startTime).isAfter(dayjs()))
      .sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime())[0];

    if (!upcoming) {
      return res.status(404).json({ message: "No upcoming appointment found" });
    }

    await prisma.appointment.delete({ where: { id: upcoming.id } });

    await prisma.notification.create({
      data: {
        created_by: userId,
        title: "Deleted appointment occurrence",
        description: `${customerName}'s single appointment was deleted.`,
        customer_name: customerName,
        quote_amount: upcoming.quote_amount ?? 0,
        deposit_amount: upcoming.deposit_amount ?? 0,
        deposit_category: upcoming.deposit_category ?? "",
        extra_deposit_category: upcoming.extra_deposit_category ?? "",
        appointment_start_time: upcoming.startTime ?? new Date(),
        appointment_end_time: upcoming.endTime ?? new Date(),
      },
    });
    return res.json({ message: "Deleted one occurrence" });
  } catch (error) {
    console.error("❌ deleteRecurringAppointments error:", error);
    res
      .status(500)
      .json({ message: "Failed to delete recurring appointments" });
  }
};
