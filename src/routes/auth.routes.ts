import express from "express";
import {
  register,
  login,
  logInByIdToken,
  createPaymentRequest,
} from "../controllers/auth.controller";
import { getAllMiniPhoto } from "../controllers/management.controller";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/login/id-token", logInByIdToken);
router.get("/mini-photo", getAllMiniPhoto);
router.post("/create-payment-request", createPaymentRequest);
export default router;
