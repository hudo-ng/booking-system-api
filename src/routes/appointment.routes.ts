import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  getAppointments,
  updateAppointment,
  updateAppointmentStatus,
  getAppointmentHistory,
} from "../controllers/appointment.controller";

const router = Router();

router.use(authenticate, authorize(["admin", "employee"]));

router.get("/", getAppointments);
router.get("/:id/history", getAppointmentHistory);
router.patch("/:id/status", updateAppointmentStatus);
router.patch("/:id", updateAppointment);

export default router;
