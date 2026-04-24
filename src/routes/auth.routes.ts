import express from "express";
import {
  register,
  login,
  logInByIdToken,
  createPaymentRequest,
  createVerification,
  validateVerification,
  getTrackingPaymentById,
  changePassword,
  createSignInCustomer,
  updateSignInCustomerByDocumentId,
  createAdminPaymentRequest,
  calculateTotalCapturedHourFromWorkShift,
  getPaystubForZoe,
  sendWeeklyReceptionPaystub,
  sendArtistPaystub,
  sendPaystubArtistNicole,
  fixMissingTattooSpending,
  sendAllArtistPaystubs,
  scriptInsertData,
  getServiceDemographics,
  sendZoePaystub,
  verifyAdminPaymentRequest,
} from "../controllers/auth.controller";
import { getAllMiniPhoto } from "../controllers/management.controller";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/login/id-token", logInByIdToken);
router.get("/mini-photo", getAllMiniPhoto);
// router.post("/create-square-payment-request", createSquareRequest);
router.post("/create-payment-request", createPaymentRequest);
router.post("/create-payment-request/admin", createAdminPaymentRequest);
router.post("/verify-payment-request/admin", verifyAdminPaymentRequest);
router.get("/payment/:id", getTrackingPaymentById);
// Create and send verification code
router.post("/verification/create", createVerification);
// Validate code
router.post("/verification/validate", validateVerification);

router.post("/change-password", changePassword);
router.post("/form", createSignInCustomer);
router.put("/form", updateSignInCustomerByDocumentId);
// Script
router.get("/script/tattoo", fixMissingTattooSpending);
router.get("/script/data", scriptInsertData);
router.get("/script/zip_code", getServiceDemographics);
// router.get("/script/post", getLatestInstagramPost);
// Paystub
router.get("/paystub/reception", calculateTotalCapturedHourFromWorkShift);
router.get("/paystub/send/reception", sendWeeklyReceptionPaystub);
router.get("/paystub/send/zoe", sendZoePaystub);
router.get("/paystub/send/piercing", sendArtistPaystub);
router.get("/paystub/send/damian", sendAllArtistPaystubs);
router.get("/paystub/send/piercing/nicole", sendPaystubArtistNicole);
router.get("/paystub/piercings", getPaystubForZoe);
export default router;
