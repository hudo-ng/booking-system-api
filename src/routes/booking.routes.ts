import { Router } from "express";
import {
  requestBooking,
  listAttachments,
} from "../controllers/booking.controller";
import { imageKit } from "../utils/imagekit";

const router = Router();

router.get("/imagekit/auth", (_req, res) => {
  const auth = imageKit.getAuthenticationParameters();
  res.json(auth);
});

router.post("/:id/request-booking", requestBooking);
router.get("/:id/attachments", listAttachments);

export default router;
