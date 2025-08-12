import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  getAllAppointments,
  getAppointmentById,
  getAppointments,
  updateAppointment,
  updateAppointmentStatus,
  getAppointmentHistory,
  createAppointment,
  getAllAppointmentsBySelectedDate,
} from "../controllers/appointment.controller";

const router = Router();

router.use(authenticate, authorize(["admin", "employee"]));

router.get("/all", getAllAppointments);
router.get("/all/by-date", getAllAppointmentsBySelectedDate);
router.get("/", getAppointments);
router.get("/:id/history", getAppointmentHistory);
router.patch("/:id/status", updateAppointmentStatus);
router.patch("/:id", updateAppointment);
router.get("/:id", getAppointmentById);
router.post("/create", createAppointment);

export default router;
