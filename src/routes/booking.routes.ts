import { Router } from "express";
import {
  requestBooking,
  bookWithPayment,
  bookWithStorePayment,
  listAttachments,
} from "../controllers/booking.controller";
import { imageKit } from "../utils/imagekit";
import { authenticate } from "../middleware/auth";

const router = Router();

router.get("/imagekit/auth", (_req, res) => {
  const auth = imageKit.getAuthenticationParameters();
  // The public key is safe to share; the mobile app needs it for signed uploads.
  res.json({ ...auth, publicKey: process.env.IMAGEKIT_PUBLIC_URL });
});

router.post("/:id/request-booking", requestBooking);
router.post("/:id/book-with-payment", bookWithPayment);
router.post(
  "/:id/book-with-store-payment",
  authenticate,
  bookWithStorePayment,
);
router.get("/:id/attachments", listAttachments);

export default router;
