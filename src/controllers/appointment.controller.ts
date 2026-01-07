import { Request, Response } from "express";
import { PrismaClient, AppointmentStatus } from "@prisma/client";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { generateOccurrences } from "../utils/generateOccurrences";
import { sendSMS } from "../utils/sms";
// import { sendSMS } from "../utils/sms";

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
    return res.status(401).json({ message: "Unauthorized" });
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
      quote_amount,
      deposit_amount,
      deposit_category,
      extra_deposit_category,
      assignedById,
      is_sms_released,
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

    // ✅ Use transaction to ensure consistency
    const result = await prisma.$transaction(async (tx) => {
      // 1️⃣ Create Appointment
      const appointment = await tx.appointment.create({
        data: {
          employeeId: employeeId ?? userId,
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
          source_booking: "manual",
          // ✅ Force deposit status to pending
          deposit_status: deposit_amount > 0 ? "pending" : "ignored",
        },
        include: {
          employee: {
            select: { id: true, name: true, phone_number: true },
          },
          assignedBy: {
            select: { id: true, name: true },
          },
        },
      });
      if (deposit_amount > 0) {
        await tx.depositAppointment.create({
          data: {
            appointment_id: appointment.id,
            status: "pending",
            deposit_amount,
            deposit_category,
            extra_deposit_category,
            updatedAt: new Date(),
            createdAt: new Date(),
          },
        });
      }
      // 3️⃣ Create Notification
      await tx.notification.create({
        data: {
          created_by: userId,
          title: "created new appointment",
          description: detail ?? "No description provided",
          customer_name: customerName ?? "No name provided",
          quote_amount,
          deposit_amount,
          deposit_category,
          extra_deposit_category,
          appointment_start_time: startTime ? new Date(startTime) : new Date(),
          appointment_end_time: endTime ? new Date(endTime) : new Date(),
          appointment_id: appointment.id,
        },
      });

      return appointment;
    });

    // ✅ SMS Notifications
    if (is_sms_released) {
      const chicagoTime = dayjs(result.startTime)
        .tz("America/Chicago")
        .format("MMM DD YYYY hh:mm A");

      const customerBody = `Thank you for choosing Hyper Inkers! Your appointment has been scheduled with Artist: ${result.employee.name} on ${chicagoTime}. Deposit: ${result.deposit_amount} USD. Prepare: https://tinyurl.com/52x5pjx4`;
      const artistBody = `New appointment with customer ${
        result.customerName
      } has been scheduled ${
        result?.assignedBy?.name ? ` by ${result?.assignedBy?.name}` : ""
      }} with Artist: ${
        result?.employee?.name
      } on ${chicagoTime} with deposit: ${result?.deposit_amount}USD via ${
        result?.deposit_category
      }`;
      await sendSMS(phone, customerBody);
      result?.employee?.phone_number &&
        (await sendSMS(result?.employee?.phone_number, artistBody));
    }

    return res.status(201).json(result);
  } catch (error) {
    console.error("Failed to create appointment", error);
    return res.status(500).json({ message: "Failed to create appointment" });
  }
};

export const duplicateAppointment = async (req: Request, res: Response) => {
  const { userId } = (req as any).user as { userId?: string };
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const {
      current_appointment_id,
      transfer_deposit,

      employeeId,
      customerName,
      email,
      phone,
      detail,
      startTime,
      endTime,
      quote_amount,
      assignedById,
      is_sms_released,
    } = req.body;

    if (!current_appointment_id) {
      return res.status(400).json({
        message: "current_appointment_id is required",
      });
    }

    // ✅ Validate time
    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);

      if (end <= start) {
        return res.status(400).json({
          message: "End time must be after start time",
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1️⃣ Get current appointment + deposit record
      const currentAppointment = await tx.appointment.findUnique({
        where: { id: current_appointment_id },
        include: {
          DepositAppointment: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!currentAppointment) {
        throw new Error("Original appointment not found");
      }

      const currentDeposit = currentAppointment.DepositAppointment?.[0];

      // 2️⃣ Decide deposit values for NEW appointment
      const newDepositAmount = transfer_deposit
        ? currentAppointment.deposit_amount ?? 0
        : 0;

      const newDepositCategory =
        transfer_deposit && currentAppointment?.deposit_category
          ? currentAppointment?.deposit_category
          : "No deposit";

      const newExtraDepositCategory = transfer_deposit
        ? currentAppointment.extra_deposit_category
        : "";

      // 3️⃣ Create NEW appointment
      const newAppointment = await tx.appointment.create({
        data: {
          employeeId: employeeId ?? currentAppointment.employeeId,
          assignedById: assignedById ?? userId,

          customerName,
          email,
          phone,
          detail,
          status: "accepted",
          source_booking: "manual",
          startTime: startTime ? new Date(startTime) : null,
          endTime: endTime ? new Date(endTime) : null,

          quote_amount,
          deposit_amount: newDepositAmount,
          deposit_category: newDepositCategory,
          extra_deposit_category: newExtraDepositCategory,

          deposit_status: currentAppointment.deposit_status,
        },
        include: {
          employee: {
            select: { id: true, name: true, phone_number: true },
          },
          assignedBy: {
            select: { id: true, name: true },
          },
        },
      });

      // 4️⃣ Transfer DepositAppointment (MOVE it)
      if (transfer_deposit) {
        if (currentDeposit) {
          // Move deposit record to new appointment
          await tx.depositAppointment.update({
            where: { id: currentDeposit.id },
            data: {
              appointment_id: newAppointment.id,
              updatedAt: new Date(),
            },
          });
        }
        // Reset deposit info on ORIGINAL appointment
        await tx.appointment.update({
          where: { id: current_appointment_id },
          data: {
            deposit_amount: 0,
            deposit_category: "Has been moved",
            extra_deposit_category: "",
            deposit_status: "ignored",
          },
        });
      }

      // 5️⃣ Notification
      await tx.notification.create({
        data: {
          created_by: userId,
          title: "duplicated appointment",
          description: detail ?? "No description provided",
          customer_name: customerName ?? "No name provided",
          quote_amount,
          deposit_amount: newDepositAmount,
          deposit_category: newDepositCategory,
          extra_deposit_category: newExtraDepositCategory,
          appointment_start_time: startTime ? new Date(startTime) : new Date(),
          appointment_end_time: endTime ? new Date(endTime) : new Date(),
          appointment_id: newAppointment.id,
        },
      });

      return newAppointment;
    });

    // 6️⃣ SMS (optional)
    if (is_sms_released) {
      const chicagoTime = dayjs(result.startTime)
        .tz("America/Chicago")
        .format("MMM DD YYYY hh:mm A");

      const customerBody = `Thank you for choosing Hyper Inkers! Your appointment has been scheduled with Artist: ${result.employee.name} on ${chicagoTime}. Deposit: ${result.deposit_amount} USD. Prepare: https://tinyurl.com/52x5pjx4`;
      const artistBody = `New appointment with customer ${
        result.customerName
      } has been scheduled ${
        result?.assignedBy?.name ? ` by ${result?.assignedBy?.name}` : ""
      }} with Artist: ${
        result?.employee?.name
      } on ${chicagoTime} with deposit: ${result?.deposit_amount}USD via ${
        result?.deposit_category
      }`;
      await sendSMS(phone, customerBody);
      result?.employee?.phone_number &&
        (await sendSMS(result?.employee?.phone_number, artistBody));
    }

    return res.status(201).json(result);
  } catch (error) {
    console.error("Failed to duplicate appointment", error);
    return res.status(500).json({
      message: "Failed to duplicate appointment",
    });
  }
};

export const getLatestDepositAppointment = async (
  req: Request,
  res: Response
) => {
  try {
    const deposits = await prisma.depositAppointment.findMany({
      take: 100,
      orderBy: {
        createdAt: "desc",
      },
      include: {
        appointment: {
          select: {
            id: true,
            customerName: true,
            startTime: true,
            endTime: true,
            deposit_amount: true,
            deposit_category: true,
            employee: {
              select: { id: true, name: true, colour: true },
            },
          },
        },
      },
    });

    return res.json(deposits);
  } catch (error) {
    console.error("Failed to fetch latest deposit appointments", error);
    return res
      .status(500)
      .json({ message: "Failed to fetch deposit appointments" });
  }
};
export const updateDepositAppointment = async (req: Request, res: Response) => {
  const {
    id,
    status,
    deposit_amount,
    deposit_category,
    extra_deposit_category,
  } = req.body;

  if (!id) {
    return res
      .status(400)
      .json({ message: "DepositAppointment id is required" });
  }

  if (!status) {
    return res.status(400).json({ message: "status is required" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1️⃣ Update DepositAppointment
      const updatedDeposit = await tx.depositAppointment.update({
        where: { id },
        data: {
          status,
          deposit_amount,
          deposit_category,
          extra_deposit_category,
          updatedAt: new Date(),
        },
      });

      // 2️⃣ Sync Appointment.deposit_status
      await tx.appointment.update({
        where: { id: updatedDeposit.appointment_id },
        data: {
          deposit_status: status,
        },
      });

      return updatedDeposit;
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to update deposit appointment", error);
    return res
      .status(500)
      .json({ message: "Failed to update deposit appointment" });
  }
};

export const updateDepositStatusInAppointment = async (
  req: Request,
  res: Response
) => {
  const { appointment_id, status } = req.body;

  if (!appointment_id) {
    return res.status(400).json({
      message: "appointment_id is required",
    });
  }

  if (!status) {
    return res.status(400).json({
      message: "status is required",
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1️⃣ Update appointment deposit_status
      await tx.appointment.update({
        where: { id: appointment_id },
        data: {
          deposit_status: status,
        },
      });

      // 2️⃣ Find deposits
      const deposits = await tx.depositAppointment.findMany({
        where: { appointment_id },
        select: { id: true },
      });

      // 3️⃣ Update ALL deposits if any exist
      if (deposits.length > 0) {
        await tx.depositAppointment.updateMany({
          where: { appointment_id },
          data: {
            status,
            updatedAt: new Date(),
          },
        });
      }

      return {
        appointment_id,
        deposit_status: status,
        updated_deposits: deposits.length,
      };
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to sync deposit status", error);
    return res.status(500).json({
      message: "Failed to update deposit status in appointment",
    });
  }
};

export const createDepositAppointment = async (req: Request, res: Response) => {
  try {
    const {
      appointment_id,
      deposit_amount,
      deposit_category,
      extra_deposit_category,
      attachment_url,
    } = req.body;
    const { userId } = (req as any).user as { userId?: string };
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!appointment_id) {
      return res.status(400).json({
        message: "appointment_id is required",
      });
    }

    // Find existing deposit appointment
    const existingDeposit = await prisma.depositAppointment.findFirst({
      where: { appointment_id },
    });

    let deposit;

    if (existingDeposit) {
      // Update existing deposit appointment
      if (deposit_amount > 0) {
        deposit = await prisma.depositAppointment.update({
          where: { id: existingDeposit.id },
          data: {
            deposit_amount,
            deposit_category,
            extra_deposit_category,
            attachment_url,
            updatedAt: new Date(),
            status: "pending",
          },
        });
      }
    } else {
      // Create new deposit appointment
      if (deposit_amount > 0) {
        deposit = await prisma.depositAppointment.create({
          data: {
            appointment_id,
            status: "pending",
            deposit_amount,
            deposit_category,
            extra_deposit_category,
            attachment_url,
            updatedAt: new Date(),
            createdAt: new Date(),
          },
        });
      }
    }

    // Update the corresponding Appointment record
    const updated = await prisma.appointment.update({
      where: { id: appointment_id },
      data: {
        deposit_amount,
        deposit_category,
        extra_deposit_category,
        deposit_status: deposit_amount > 0 ? "pending" : "ignored",
      },
    });

    // ✅ Create notification
    await prisma.notification.create({
      data: {
        created_by: userId,
        description: updated?.detail
          ? updated?.detail
          : "No description provided",
        title: "edit deposit",
        customer_name: updated?.customerName
          ? updated?.customerName
          : "No name provided",
        quote_amount: updated?.quote_amount ? updated?.quote_amount : 0,
        deposit_amount,
        deposit_category,
        extra_deposit_category,
        appointment_start_time: updated?.startTime
          ? new Date(updated?.startTime)
          : new Date(),
        appointment_end_time: updated?.endTime
          ? new Date(updated?.endTime)
          : new Date(),
        appointment_id: updated.id,
      },
    });

    return res.status(existingDeposit ? 200 : 201).json(deposit);
  } catch (error) {
    console.error("Failed to create/update deposit appointment", error);
    return res.status(500).json({
      message: "Failed to create/update deposit appointment",
    });
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
      is_sms_released,
    } = req.body;

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
    // ✅ Build update object ONLY with provided values
    const data: any = {};
    const fields = {
      employeeId,
      customerName,
      email,
      phone,
      detail,
      quote_amount,
      deposit_amount,
      deposit_category,
      extra_deposit_category,
    };

    // ✅ Add only non-undefined fields
    const fieldKeys = Object.keys(fields) as (keyof typeof fields)[];
    for (const key of fieldKeys) {
      const value = fields[key];
      if (value !== undefined) {
        data[key] = value;
      }
    }

    // ✅ Convert times only when provided
    if (startTime !== undefined)
      data.startTime = startTime ? new Date(startTime) : null;
    if (endTime !== undefined)
      data.endTime = endTime ? new Date(endTime) : null;

    // ✅ Run the update
    const updated = await prisma.appointment.update({
      where: { id },
      data,
      include: {
        employee: { select: { id: true, name: true } },
      },
    });

    // ✅ Create notification
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
        appointment_id: updated.id,
      },
    });

    // ✅ Send SMS if requested
    if (is_sms_released && updated.phone) {
      const chicagoTime = dayjs(updated.startTime)
        .tz("America/Chicago")
        .format("MMM DD YYYY hh:mm A");
      const customerBody = `Your appointment with ${updated.employee.name} has been re-scheduled to ${chicagoTime}.\nText (210) 997-9737 or your artist to reschedule when you’re ready`;

      await sendSMS(updated.phone, customerBody);
    }

    return res.json(updated);
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
  const { appointmentId, issendSMS } = req.query as {
    appointmentId?: string;
    issendSMS: string;
  };
  const is_sms_released = issendSMS === "true" ? true : false;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!appointmentId)
    return res.status(400).json({ message: "Appointment ID required" });

  try {
    // ✅ Step 1: Delete all attachments linked to this appointment
    await prisma.appointmentAttachment.deleteMany({
      where: { appointmentId },
    });
    await prisma.depositAppointment.deleteMany({
      where: { appointment_id: appointmentId },
    });
    // ✅ Step 2: Delete appointment itself
    const deletedAppointment = await prisma.appointment.delete({
      where: { id: appointmentId },
      include: { employee: { select: { id: true, name: true } } },
    });

    if (is_sms_released) {
      const chicagoTime = dayjs(deletedAppointment.startTime)
        .tz("America/Chicago")
        .format("MMM DD YYYY hh:mm A");
      const customerBody = `Your appointment on ${chicagoTime} with ${deletedAppointment.employee.name} has been canceled.
Text (210) 997-9737 or your artist to reschedule when you’re ready`;
      await sendSMS(deletedAppointment.phone, customerBody);
    }
    // ✅ Step 3: Log deletion in notifications
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
      message: "Appointment and attachments deleted",
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
        status: "accepted",
      },
      orderBy: { startTime: "asc" },
      include: {
        employee: {
          select: { id: true, name: true, colour: true },
        },
        assignedBy: {
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
  const { startTime, endTime, status, issendSMS } = req.body;

  const { userId } = (req as any).user as {
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
    select: { name: true, phone_number: true },
  });

  if (!user) throw new Error("User not found");

  try {
    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        startTime: newStart,
        endTime: newEnd,
        status,
      },
      include: {
        employee: { select: { id: true, name: true, phone_number: true } },
        assignedBy: { select: { id: true, name: true } },
      },
    });
    // ✅ Send SMS if appointment is accepted
    if (issendSMS === true) {
      const chicagoTime = dayjs(updated.startTime)
        .tz("America/Chicago")
        .format("MMM DD YYYY hh:mm A");
      if (status === "accepted" && appointment.phone) {
        //   const artistBody = `Your appointment with ${appointment.customerName} is confirmed. Look forward to take care your customer soon.`;
        const customerBody = `Thank you for choosing Hyper Inkers! Your appointment has been scheduled ${
          updated.assignedBy?.name ? "by " + updated.assignedBy?.name : ""
        } with Artist: ${updated.employee.name} on ${chicagoTime}. Deposit: ${
          updated.deposit_amount
        } USD. Prepare: https://tinyurl.com/52x5pjx4`;

        await sendSMS(appointment.phone, customerBody);

        const artistBody = `New appointment with customer ${
          appointment.customerName
        } has been scheduled${
          updated?.assignedBy?.name ? ` by ${updated?.assignedBy?.name}` : ""
        } with Artist: ${
          updated?.employee?.name
        } on ${chicagoTime} with deposit: ${updated?.deposit_amount} via ${
          updated?.deposit_category
        }`;

        updated?.employee?.phone_number &&
          (await sendSMS(updated?.employee?.phone_number, artistBody));
      } else {
        const customerBodyCancel = `Your appointment on ${chicagoTime} with Artist ${updated.employee.name} has been canceled.
Text (210) 997-9737 or your artist to reschedule when you’re ready`;
        await sendSMS(appointment.phone, customerBodyCancel);
        const artistBodyCancel = `The appointment with customer ${appointment.customerName} on ${chicagoTime} has been canceled.`;
        updated?.employee?.phone_number &&
          (await sendSMS(updated?.employee?.phone_number, artistBodyCancel));
      }
    }
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
              source_booking: "manual",
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

  try {
    // ✅ Check if the recurring series exists
    const series = await prisma.recurringSeries.findUnique({
      where: { id: seriesId },
    });

    if (!series) {
      return res.status(404).json({ message: "Series not found" });
    }

    // ✅ Delete only upcoming appointments (not past)
    await prisma.$transaction(async (tx) => {
      await tx.appointment.deleteMany({
        where: {
          seriesId,
          startTime: { gt: dayjs().toDate() }, // only delete future appointments
        },
      });

      await tx.recurringSeries.update({
        where: { id: seriesId },
        data: { isActive: false },
      });
    });

    return res.json({
      message: "Future appointments deleted and series deactivated",
      seriesId,
    });
  } catch (error) {
    console.error("❌ deleteRecurringAppointments error:", error);
    return res.status(500).json({
      message: "Failed to delete recurring appointments",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getAppointmentsByAssigneeAndDate = async (
  req: Request,
  res: Response
) => {
  const { assigneeId } = req.params;
  const { startDate, endDate } = req.query;

  try {
    if (!assigneeId || !startDate || !endDate) {
      return res.status(400).json({ message: "Missing required parameters" });
    }

    const start = dayjs(startDate as string)
      .startOf("day")
      .toDate();
    const end = dayjs(endDate as string)
      .endOf("day")
      .toDate();

    const appointments = await prisma.appointment.findMany({
      where: {
        assignedById: assigneeId,
        startTime: { gte: start, lte: end },
      },
      include: {
        employee: true,
      },
      orderBy: { startTime: "asc" },
    });

    res.json({ appointments });
  } catch (error) {
    console.error("❌ getAppointmentsByAssigneeAndDate error:", error);
    res.status(500).json({ message: "Failed to fetch appointments" });
  }
};
