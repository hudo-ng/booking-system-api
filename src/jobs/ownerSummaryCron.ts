import { PrismaClient } from "@prisma/client";
import { sendPushAsync } from "../services/push";
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();
const ZONE = "America/Chicago";

interface ServiceMetrics {
  paidMoney: number;
  formPaid: number;
  formNotPaid: number;
}

/**
 * Independent Cron Task:
 * Runs nightly on Render to pull operational records from 29 hours ago,
 * stores the metrics inside the database, and pushes a dense notification to owners.
 */
export async function runOwnerDailySummaryCron() {
  try {
    console.log("🚀 Starting independent Owner Daily Summary task...");

    // 1. Target the correct historical snapshot window (Current time minus 29 hours)
    const targetDate = dayjs().tz(ZONE).subtract(12, "hour");
    const formattedDate = targetDate.format("MMDDYYYY");
    const displayDate = targetDate.format("MM/DD");

    // Normalize date to midnight for consistent relational database queries
    const dbDate = targetDate.startOf("day").toDate();

    // 2. Query data logs from the external API
    const response = await axios.post(
      "https://hyperinkersform.com/api/fetching",
      {
        endDate: formattedDate,
      },
    );

    const items: any[] = response.data?.data || [];
    if (!items.length) {
      console.log(
        `ℹ️ No form data records returned for operational date: ${displayDate}`,
      );
      return { status: "empty", date: targetDate.format("YYYY-MM-DD") };
    }

    const totalFormsCount = items.length;

    // 3. Accumulate data rows into mapping structure: reportMap[artistName][serviceString]
    const reportMap: Record<string, Record<string, ServiceMetrics>> = {};

    items.forEach((item) => {
      const artistName = item.artist?.trim() || "Unknown";
      const paymentValue = parseFloat(item.paid_money) || 0;

      // Categorize basic service types using string matching rules
      const service = item.color === "piercing" ? "piercing" : "tattoo";

      // Compute workflow completion status indicators
      const status = item.status?.toLowerCase();
      const isPaid = ["done", "paid"].includes(status) || paymentValue > 0;

      if (!reportMap[artistName]) {
        reportMap[artistName] = {};
      }
      if (!reportMap[artistName][service]) {
        reportMap[artistName][service] = {
          paidMoney: 0,
          formPaid: 0,
          formNotPaid: 0,
        };
      }

      const metrics = reportMap[artistName][service];
      metrics.paidMoney += paymentValue;
      if (isPaid) {
        metrics.formPaid += 1;
      } else {
        metrics.formNotPaid += 1;
      }
    });

    let breakdownLines: string[] = [];

    // 4. Update the DB tables and string format the notification layout concurrently
    for (const [artist, services] of Object.entries(reportMap)) {
      let segmentsText: string[] = [];

      for (const [service, data] of Object.entries(services)) {
        const totalForm = data.formPaid + data.formNotPaid;
        if (totalForm === 0) continue;

        // Persist records securely into the DailyReportForm DB Table
        await prisma.dailyReportForm.upsert({
          where: {
            artist_date_service: {
              artist,
              date: dbDate,
              service,
            },
          },
          update: {
            paidMoney: data.paidMoney,
            formPaid: data.formPaid,
            formNotPaid: data.formNotPaid,
            totalForm,
          },
          create: {
            artist,
            date: dbDate,
            service,
            paidMoney: data.paidMoney,
            formPaid: data.formPaid,
            formNotPaid: data.formNotPaid,
            totalForm,
          },
        });

        const icon = service === "tattoo" ? "🎨" : "💎";
        segmentsText.push(
          `${icon}${totalForm}($${Math.round(data.paidMoney)})`,
        );
      }

      if (segmentsText.length > 0) {
        breakdownLines.push(`${artist}: ${segmentsText.join(" | ")}`);
      }
    }

    // 5. Query active system owners holding functional device tokens
    const ownersWithTokens = await prisma.user.findMany({
      where: { isOwner: true, deletedAt: null },
      select: {
        DeviceToken: {
          where: { enabled: true },
          select: { token: true },
        },
      },
    });

    const ownerTokens = ownersWithTokens.flatMap((owner) =>
      owner.DeviceToken.map((t) => t.token),
    );

    if (!ownerTokens.length) {
      console.log(
        "⚠️ Database records logged successfully, but no active owner push tokens were found.",
      );
      return { status: "saved_no_push", date: targetDate.format("YYYY-MM-DD") };
    }

    // 6. Push the compact payload out to mobile devices
    const pushBody = breakdownLines.join("\n");
    await sendPushAsync(ownerTokens, {
      title: `📊 Summary ${displayDate} (${totalFormsCount} Forms)`,
      body: pushBody,
      data: {
        type: "ownerDailySummary",
        date: targetDate.format("YYYY-MM-DD"),
      },
    });

    console.log(
      `✅ Daily metrics sync completed successfully for ${displayDate}.`,
    );
    return { status: "success", formsTracked: totalFormsCount };
  } catch (error: any) {
    console.error(
      "❌ Critical exception encountered during owner daily report cron:",
      error.message,
    );
    throw error;
  }
}
