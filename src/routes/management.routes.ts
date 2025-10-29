import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  addEmployee,
  assignUserToCleanSchedule,
  editEmployee,
  getAllEmployees,
  getAllNotification,
  getCleanSchedules,
  releaseSms,
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
export default router;
