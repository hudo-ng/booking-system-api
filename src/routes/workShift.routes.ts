import { Router } from "express";
import { validateIp } from "../middleware/validateIp";
import {
  clockIn,
  clockOut,
  extendShift,
  getWorkSchedule,
  getWorkShifts,
  setWorkScheduleByUserId,
} from "../controllers/workShift.controller";

const router = Router();

router.post("/clock-in", validateIp, clockIn);
router.post("/clock-out", clockOut);
router.post("/extend-shift", extendShift);
router.get("/", getWorkShifts);
router.get("/schedule", getWorkSchedule);
router.put("/schedule", setWorkScheduleByUserId);

export default router;
