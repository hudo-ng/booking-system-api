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
  createRecurringAppointments,
  getAllAppointmentsBySelectedDate,
  deleteAppointment,
  getCountAppointmentPending,
  updateCompletedPhotoUrlAppointmentById,
  editAppointment,
  editRecurringAppointments,
  deleteRecurringAppointments,
} from "../controllers/appointment.controller";
import { enforceDevice } from "../middleware/enforceDevice";

const router = Router();

router.use(authenticate, enforceDevice, authorize(["admin", "employee"]));

router.get("/all", getAllAppointments);
router.get("/count/pending", getCountAppointmentPending);
router.get("/all/by-date", getAllAppointmentsBySelectedDate);
router.get("/", getAppointments);
router.get("/:id/history", getAppointmentHistory);
router.patch("/:id/status", updateAppointmentStatus);
router.patch("/:id", updateAppointment);
router.put("/completed", updateCompletedPhotoUrlAppointmentById);
router.get("/:id", getAppointmentById);
router.post("/create", createAppointment);
router.post("/recurring", createRecurringAppointments);
router.put("/recurring/:seriesId", editRecurringAppointments);
router.delete("/recurring/:seriesId", deleteRecurringAppointments);
router.put("/edit", editAppointment);
router.delete("/delete", deleteAppointment);

export default router;
