import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  getAllAppointments,
  getAppointmentById,
  getAppointments,
  updateAppointment,
  updateAppointmentStatus,
} from "../controllers/appointment.controller";

const router = Router();

router.use(authenticate, authorize(["admin", "employee"]));

router.get("/all", getAllAppointments);
router.get("/", getAppointments);
router.patch("/:id/status", updateAppointmentStatus);
router.patch("/:id", updateAppointment);
router.get("/:id", getAppointmentById);

export default router;
