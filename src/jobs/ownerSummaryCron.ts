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
  card: number;
  cash: number;
  formPaid: number;
  formNotPaid: number;
}

export async function runOwnerDailySummaryCron() {
  try {
    console.log("🚀 Starting independent Owner Daily Summary task...");

    const targetDate = dayjs().tz(ZONE).subtract(12, "hour");
    const formattedDate = targetDate.format("MMDDYYYY");
    const displayDate = targetDate.format("MM/DD");
    const dbDate = targetDate.startOf("day").toDate();

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

    // Global trackers for the compact push notification layout
    let globalCardTotal = 0;
    let globalCashTotal = 0;
    let cardTattoo = 0;
    let cardPiercing = 0;

    const reportMap: Record<string, Record<string, ServiceMetrics>> = {};

    items.forEach((item) => {
      const artistName = item.artist?.trim() || "Unknown";
      const service = item.color === "piercing" ? "piercing" : "tattoo";

      const cardValue = parseFloat(item.card) || 0;
      const cashValue = parseFloat(item.cash) || 0;
      const combinedTotal = cardValue + cashValue;

      const status = item.status?.toLowerCase();
      const isPaid = ["done", "paid"].includes(status) || combinedTotal > 0;

      // Accumulate global statistics
      globalCardTotal += cardValue;
      globalCashTotal += cashValue;
      if (service === "tattoo") cardTattoo += cardValue;
      if (service === "piercing") cardPiercing += cardValue;

      if (!reportMap[artistName]) reportMap[artistName] = {};
      if (!reportMap[artistName][service]) {
        reportMap[artistName][service] = {
          card: 0,
          cash: 0,
          formPaid: 0,
          formNotPaid: 0,
        };
      }

      const metrics = reportMap[artistName][service];
      metrics.card += cardValue;
      metrics.cash += cashValue;

      if (isPaid) metrics.formPaid += 1;
      else metrics.formNotPaid += 1;
    });

    let artistLines: string[] = [];
    let piercerLines: string[] = [];

    // 🔄 Sync cleanly to Database and separate notification list items
    for (const [artist, services] of Object.entries(reportMap)) {
      let isPiercerOnly = true;
      let segmentsText: string[] = [];

      for (const [service, data] of Object.entries(services)) {
        const totalForm = data.formPaid + data.formNotPaid;
        if (totalForm === 0) continue;
        if (service !== "piercing") isPiercerOnly = false;

        await prisma.dailyReportForm.upsert({
          where: { artist_date_service: { artist, date: dbDate, service } },
          update: {
            card: data.card,
            cash: data.cash,
            formPaid: data.formPaid,
            formNotPaid: data.formNotPaid,
            totalForm,
          },
          create: {
            artist,
            date: dbDate,
            service,
            card: data.card,
            cash: data.cash,
            formPaid: data.formPaid,
            formNotPaid: data.formNotPaid,
            totalForm,
          },
        });

        const totalCombinedArtistRevenue = data.card + data.cash;
        const icon = service === "tattoo" ? "🎨" : "💎";
        segmentsText.push(
          `${icon}${totalForm}($${Math.round(totalCombinedArtistRevenue)})`,
        );
      }

      if (segmentsText.length > 0) {
        const line = `• ${artist}: ${segmentsText.join(" | ")}`;
        if (isPiercerOnly) piercerLines.push(line);
        else artistLines.push(line);
      }
    }

    // 📱 Layout dense text bubble block for notification dispatch
    const pushBody = [
      `💳 Card: $${Math.round(globalCardTotal)} | 💵 Cash: $${Math.round(globalCashTotal)}`,
      `💳 Card Tatt: $${Math.round(cardTattoo)} | Card Pierc: $${Math.round(cardPiercing)}`,
      `Artists:\n${artistLines.join("\n") || "None"}`,
      `Piercers:\n${piercerLines.join("\n") || "None"}`,
    ].join("\n");

    const ownersWithTokens = await prisma.user.findMany({
      where: { isOwner: true, deletedAt: null },
      select: {
        DeviceToken: { where: { enabled: true }, select: { token: true } },
      },
    });

    const ownerTokens = ownersWithTokens.flatMap((owner) =>
      owner.DeviceToken.map((t) => t.token),
    );
    if (!ownerTokens.length) return { status: "saved_no_push" };

    await sendPushAsync(ownerTokens, {
      title: `📊 Summary ${displayDate} (${totalFormsCount} Forms)`,
      body: pushBody,
      data: {
        type: "ownerDailySummary",
        date: targetDate.format("YYYY-MM-DD"),
        screen: "DailyReportDetails",
        params: { date: targetDate.format("YYYY-MM-DD") },
      },
    });

    return { status: "success", formsTracked: totalFormsCount };
  } catch (error: any) {
    console.error("❌ Exception during report cron:", error.message);
    throw error;
  }
}
