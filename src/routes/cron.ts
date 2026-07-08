import { Router } from "express";
import { runDailyReminder } from "../jobs/reminders";
import { runCleaningReminder } from "../jobs/cleanning-reminders";
import { runPendingAppointmentReminder } from "../jobs/pendingAppointmentReminder";
import { testSync } from "../jobs/updateGGReviews";
import { runOwnerDailySummaryCron } from "../jobs/ownerSummaryCron";

const router = Router();

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

export default router;
