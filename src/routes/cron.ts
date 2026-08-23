import { Router } from "express";
import { runDailyReminder } from "../jobs/reminders";
import { runCleaningReminder } from "../jobs/cleanning-reminders";
import { runPendingAppointmentReminder } from "../jobs/pendingAppointmentReminder";
import { testSync } from "../jobs/updateGGReviews";
import { runOwnerDailySummaryCron } from "../jobs/ownerSummaryCron";
import {
  sendWeeklyReceptionPaystubJob,
  sendZoePaystubJob,
  sendArtistPaystubJob,
  sendAllArtistPaystubsJob,
  sendPaystubArtistNicoleJob,
} from "../jobs/payStubs";

const router = Router();

const isBiWeeklyRun = () => {
  const now = new Date();
  const start = new Date("2025-01-01T00:00:00Z");
  const diffWeeks = Math.floor(
    (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7),
  );

  return diffWeeks % 2 === 0;
};

router.post("/daily-reminders", async (req, res) => {
  const secret = req.header("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runDailyReminder();
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("cron/daily-reminders error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/cleaning-reminder", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const result = await runCleaningReminder();
    res.json({ message: "Cleaning reminders processed", result });
  } catch (e: any) {
    console.error("cron/cleanning-reminders error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/pending-appointment-reminder", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const result = await runPendingAppointmentReminder();
    res.json({ message: "Pending appointment reminders processed", result });
  } catch (e: any) {
    console.error("/pending-appointment-reminder error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/google-reviews-update", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const result = await testSync();
    res.json({ message: "Google reviews updated", result });
  } catch (e: any) {
    console.error("/google-reviews-update error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/owner-daily-summary", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const result = await runOwnerDailySummaryCron();
    res.json({ message: "Owner daily summary processed successfully", result });
  } catch (e: any) {
    console.error("/owner-daily-summary error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/paystub/weekly-reception", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await sendWeeklyReceptionPaystubJob();
    return res.json({
      message: "Weekly reception paystub processed successfully",
    });
  } catch (e: any) {
    console.error("/paystub/weekly-reception error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/paystub/zoe", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!isBiWeeklyRun()) {
    return res.json({
      message: "Skipped: Zoe paystub is scheduled bi-weekly.",
    });
  }

  try {
    await sendZoePaystubJob();
    return res.json({ message: "Zoe paystub processed successfully" });
  } catch (e: any) {
    console.error("/paystub/zoe error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/paystub/artist", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!isBiWeeklyRun()) {
    return res.json({
      message: "Skipped: artist paystub is scheduled bi-weekly.",
    });
  }

  try {
    await sendArtistPaystubJob();
    return res.json({ message: "Artist paystub processed successfully" });
  } catch (e: any) {
    console.error("/paystub/artist error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/paystub/all-artists", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!isBiWeeklyRun()) {
    return res.json({
      message: "Skipped: all artist paystubs are scheduled bi-weekly.",
    });
  }

  try {
    await sendAllArtistPaystubsJob();
    return res.json({ message: "All artist paystubs processed successfully" });
  } catch (e: any) {
    console.error("/paystub/all-artists error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/paystub/nicole", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!isBiWeeklyRun()) {
    return res.json({
      message: "Skipped: Nicole paystub is scheduled bi-weekly.",
    });
  }

  try {
    await sendPaystubArtistNicoleJob();
    return res.json({ message: "Nicole paystub processed successfully" });
  } catch (e: any) {
    console.error("/paystub/nicole error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
