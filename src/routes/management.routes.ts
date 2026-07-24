import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  addEmployee,
  assignUserToCleanSchedule,
  createMiniPhoto,
  deleteDeviceToken,
  deleteEmployee,
  editEmployee,
  getAllEmployees,
  getAllMiniPhoto,
  getAllNotification,
  getAllNotificationByAppointmentId,
  getCleanSchedules,
  getDailyReportBySelectedDate,
  getDailyReportFormBySelectedMonthYear,
  getListOfBookedAppointmentsByFormId,
  getPaidPayments,
  getSignInCustomers,
  releaseSms,
  requestTattooArtistPaymentByUserId,
  returnPaymentRequest,
  updateMiniPhoto,
  voidPaymentRequest,
} from "../controllers/management.controller";
import { enforceDevice } from "../middleware/enforceDevice";
import {
  generateNicolePaystubData,
  generateYenPaystubData,
  generateZoePaystubData,
} from "../controllers/auth.controller";

const router = Router();

router.use(authenticate, enforceDevice, authorize(["admin", "employee"]));
router.get("/employees", getAllEmployees);
router.post("/employee/delete", deleteEmployee);
router.post("/employee/delete/deviceId", deleteDeviceToken);
router.put("/employees/edit", editEmployee);
router.post("/employees/add", addEmployee);
router.get("/notification/all", getAllNotification);
router.get("/notification/appointment/all", getAllNotificationByAppointmentId);
router.get("/clean-schedule", getCleanSchedules);
router.put("/clean-schedule/edit", assignUserToCleanSchedule);
router.post("/sms/release", releaseSms);
router.post("/mini-photo", createMiniPhoto);
router.get("/mini-photo", getAllMiniPhoto);
router.put("/mini-photo", updateMiniPhoto);
router.get("/sign-in-customers", getSignInCustomers);
router.get("/booked-appointments", getListOfBookedAppointmentsByFormId);
router.get(
  "/daily-report/monthly-summary",
  getDailyReportFormBySelectedMonthYear,
);
router.get("/daily-report/daily-summary", getDailyReportBySelectedDate);
router.post("/tattoo-artist", requestTattooArtistPaymentByUserId);

router.post("/zoe-artist", generateZoePaystubData);
router.post("/yen-artist", generateYenPaystubData);
router.post("/nicole-artist", generateNicolePaystubData);
// GET: Fetch successful transactions (statusCode "0000", Cash, CashApp) to build your management table
router.get("/payments/paid", getPaidPayments);

// POST: Process dynamic terminal selection (terminal_1 / terminal_2) voids or cash reversals
router.post("/payments/void", voidPaymentRequest);
router.post("/payments/return", returnPaymentRequest);
export default router;
