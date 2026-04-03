import { Router } from "express";
import {
  clockIn,
  clockOut,
  createShiftRequest,
  editClockInAndClockOutTimeByShiftId,
  extendShift,
  getAllShiftRequestsByOwner,
  getPaymentReport,
  getPaystub,
  getPiercingReport,
  getTattooReport,
  getWorkSchedule,
  getWorkShifts,
  getWorkShiftsByMonth,
  getWorkShiftsFull,
  reviewShiftRequest,
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
router.post("/clock-in/request", createShiftRequest);
router.get("/owner/review-request", getAllShiftRequestsByOwner);
router.post("/owner/review-request", reviewShiftRequest);
router.post("/extend-shift", extendShift);
router.put("/edit-clockinout", editClockInAndClockOutTimeByShiftId);
router.get("/", getWorkShifts);
router.get("/schedule", getWorkSchedule);
router.put("/schedule", setWorkScheduleByUserId);
router.post("/piercing-report", getPiercingReport);
router.post("/tattoo-report", getTattooReport);
router.post("/payment-report", getPaymentReport);
router.get("/paystub", getPaystub);

export default router;
