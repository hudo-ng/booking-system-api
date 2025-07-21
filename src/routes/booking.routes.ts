import { Router } from "express";
import { requestBooking } from "../controllers/booking.controller";

const router = Router();

router.post("/:id/request-booking", requestBooking);

export default router;
