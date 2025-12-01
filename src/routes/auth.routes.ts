import express from "express";
import {
  register,
  login,
  logInByIdToken,
  createPaymentRequest,
  createVerification,
  validateVerification,
} from "../controllers/auth.controller";
import { getAllMiniPhoto } from "../controllers/management.controller";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/login/id-token", logInByIdToken);
router.get("/mini-photo", getAllMiniPhoto);
router.post("/create-payment-request", createPaymentRequest);
// Create and send verification code
router.post("/verification/create", createVerification);
// Validate code
router.post("/verification/validate", validateVerification);
export default router;
