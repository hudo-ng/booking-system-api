import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticate, authorize } from "../middleware/auth";
import { sendPushAsync } from "../services/push";

const router = Router();

const prisma = new PrismaClient();

router.use(authenticate, authorize(["admin", "employee"]));

router.post("/register", async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { token, platform } = req.body as {
      token: string;
      platform?: string;
    };
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!token) return res.status(400).json({ error: "token required" });

    await prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform, lastSeen: new Date(), enabled: true },
      create: { userId, token, platform },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("/devices/register error:", e);
    res.status(500).json({ error: "Failed to register token" });
  }
});

router.post("/test", async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { title, body, data } = req.body ?? {};
    const msg = {
      title: title ?? "Test Notification",
      body: body ?? "If you can read this, push works!",
      data: data ?? { ping: true },
    };

    const tokens = (
      await prisma.deviceToken.findMany({
        where: { userId, enabled: true },
        select: { token: true },
      })
    ).map((d) => d.token);
    if (tokens.length === 0)
      return res.json({ ok: true, info: "No tokens for user." });

    const results = await sendPushAsync(tokens, msg);
    res.json({ ok: true, count: tokens.length, results });
  } catch (e) {
    console.error("/devices/test error:", e);
    res.status(500).json({ error: "Failed to send test notification" });
  }
});

router.post("/warning", async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { title, body, data } = req.body ?? {};
    const msg = {
      title: title ?? "** WARNING **",
      body:
        body ??
        "Please turn on the app in 10 minutes, if not you will be clocked out",
      data: data ?? { ping: true },
    };

    const tokens = (
      await prisma.deviceToken.findMany({
        where: { userId, enabled: true },
        select: { token: true },
      })
    ).map((d) => d.token);

    if (tokens.length === 0)
      return res.json({ ok: true, info: "No tokens for user." });

    const results = await sendPushAsync(tokens, msg);
    res.json({ ok: true, count: tokens.length, results });
  } catch (e) {
    console.error("/devices/test error:", e);
    res.status(500).json({ error: "Failed to send test notification" });
  }
});

export default router;
