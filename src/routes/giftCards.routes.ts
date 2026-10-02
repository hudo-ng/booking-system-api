import Router from "express";
import {
  purchaseGiftCard,
  getGiftCardByCode,
  redeemGiftCard,
} from "../controllers/giftCard.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.post("/purchase", purchaseGiftCard);
router.get("/:code", getGiftCardByCode);
router.post("/redeem", authenticate, redeemGiftCard);

export default router;
