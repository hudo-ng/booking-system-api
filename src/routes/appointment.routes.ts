import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  getAppointments,
  updateAppointmentStatus,
} from "../controllers/appointment.controller";

const router = Router();

router.use(authenticate, authorize(["admin", "employee"]));

router.get("/", getAppointments);
router.patch("/:id/status", updateAppointmentStatus);

export default router;
