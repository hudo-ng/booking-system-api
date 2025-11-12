import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  addEmployee,
  assignUserToCleanSchedule,
  createMiniPhoto,
  editEmployee,
  getAllEmployees,
  getAllMiniPhoto,
  getAllNotification,
  getCleanSchedules,
  releaseSms,
  updateMiniPhoto,
} from "../controllers/management.controller";
import { enforceDevice } from "../middleware/enforceDevice";

const router = Router();

router.use(authenticate, enforceDevice, authorize(["admin", "employee"]));
router.get("/employees", getAllEmployees);
router.put("/employees/edit", editEmployee);
router.post("/employees/add", addEmployee);
router.get("/notification/all", getAllNotification);
router.get("/employees", getAllEmployees);
router.get("/clean-schedule", getCleanSchedules);
router.put("/clean-schedule/edit", assignUserToCleanSchedule);
router.post("/sms/release", releaseSms);
router.post("/mini-photo", createMiniPhoto);
router.get("/mini-photo", getAllMiniPhoto);
router.put("/mini-photo", updateMiniPhoto);
export default router;
