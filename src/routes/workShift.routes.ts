import { Router } from "express";
import {
  clockIn,
  clockOut,
  createShiftRequest,
  editClockInAndClockOutTimeByShiftId,
  extendShift,
  getAllContentBonuses,
  getAllShiftRequestsByOwner,
  getPaymentReport,
  getPaystub,
  getPiercingReport,
  getQuickBonusSettings,
  getTattooReport,
  getWorkSchedule,
  getWorkShifts,
  getWorkShiftsByMonth,
  getWorkShiftsFull,
  reviewShiftRequest,
  saveDailyContentBonus,
  setWorkScheduleByUserId,
  updateQuickBonusSettings,
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
// Main dashboard pipeline view: Fetch stats/bonuses for "saleContent" staff across a date range
router.get("/content-bonus", getAllContentBonuses);

// Update or set a specific day's bonus amount (supports explicit dollar amounts or quick Tier keys)
router.post("/content-bonus/save", saveDailyContentBonus);

// Retrieve the global owner shortcuts/settings dictionary (e.g., A: 50, B: 100, C: 150)
router.get("/content-bonus/settings", getQuickBonusSettings);

// Create, seed, or update the quick-matching configurations for tiers A, B, C, etc.
router.put("/content-bonus/settings", updateQuickBonusSettings);

export default router;
