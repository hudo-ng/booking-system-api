import { Router } from "express";
import {
  clockIn,
  clockOut,
  extendShift,
  getWorkSchedule,
  getWorkShifts,
  getWorkShiftsByMonth,
  setWorkScheduleByUserId,
} from "../controllers/workShift.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

router.use(authenticate, authorize(["admin", "employee"]));
router.get("/clock-history", getWorkShiftsByMonth);
router.post("/clock-in", clockIn);
router.post("/clock-out", clockOut);
router.post("/extend-shift", extendShift);
router.get("/", getWorkShifts);
router.get("/schedule", getWorkSchedule);
router.put("/schedule", setWorkScheduleByUserId);

export default router;
