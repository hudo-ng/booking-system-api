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
  releaseSms,
  updateMiniPhoto,
} from "../controllers/management.controller";
import { enforceDevice } from "../middleware/enforceDevice";

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
export default router;
