import { Router } from "express";
import {
  clockIn,
  clockOut,
  editClockInAndClockOutTimeByShiftId,
  extendShift,
  getPiercingReport,
  getTattooReport,
  getWorkSchedule,
  getWorkShifts,
  getWorkShiftsByMonth,
  getWorkShiftsFull,
  setWorkScheduleByUserId,
} from "../controllers/workShift.controller";
import { authenticate, authorize } from "../middleware/auth";
import { enforceDevice } from "../middleware/enforceDevice";

const router = Router();

router.use(authenticate, enforceDevice, authorize(["admin", "employee"]));
router.get("/clock-history", getWorkShiftsByMonth);
router.get("/full/clock-history", getWorkShiftsFull);
router.post("/clock-in", clockIn);
router.post("/clock-out", clockOut);
router.post("/extend-shift", extendShift);
router.put("/edit-clockinout", editClockInAndClockOutTimeByShiftId);
router.get("/", getWorkShifts);
router.get("/schedule", getWorkSchedule);
router.put("/schedule", setWorkScheduleByUserId);
router.post("/piercing-report", getPiercingReport);
router.post("/tattoo-report", getTattooReport);

export default router;
