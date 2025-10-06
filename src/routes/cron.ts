import { Router } from "express";
import { runDailyReminder } from "../jobs/reminders";

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

export default router;
