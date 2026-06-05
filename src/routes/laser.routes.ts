import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { enforceDevice } from "../middleware/enforceDevice";
import {
  createCustomer,
  getCustomers,
  createPackage,
  getPackages,
  purchasePackage,
  getCustomerPackages,
  createLaserVisit,
  getLaserVisits,
  updateLaserVisit,
  deleteLaserVisit,
  getOneHundredLatestHistoryOfPurchase,
  deletePackage,
  syncLaserVisitFromApp,
  getLatestVisitsLogs,
  getListOfVisitAndHistoryUsageByLaserCustomerId,
  settleVisitWithPackage,
  purchasePackageForCustomer,
} from "../controllers/laser.controller";

const router = Router();

// Applying standard auth and device protections
router.use(authenticate, enforceDevice, authorize(["admin", "employee"]));

// Laser Customer Profiles
router.post("/customer", createCustomer);
router.get("/customer", getCustomers); // Filterable via ?phone= or ?id=

// Core Package Templates
router.post("/package", createPackage);
router.get("/package", getPackages);
router.delete("/packages/:id", authenticate, deletePackage);

// Customer Package Inventories (Purchases & Balances)
router.post("/customer-package", purchasePackage);
router.get("/customer-package", getCustomerPackages); // Filterable via ?customerId=

// Laser Visit / Intake / Session Data Logs (No route parameters used)
router.post("/visit", createLaserVisit);
router.get("/visit", getLaserVisits); // Filterable via ?id= or ?customerId=
router.put("/visit", updateLaserVisit); // Uses ?id= query parameter to target specific entries
router.delete("/visit", deleteLaserVisit); // Uses ?id= query parameter to target specific entries
// Secure tracking endpoint context
router.get("/purchase-history", getOneHundredLatestHistoryOfPurchase);
router.post("/sync-app-visit", syncLaserVisitFromApp);
router.get("/latest-visits", getLatestVisitsLogs);
router.get("/customer-history", getListOfVisitAndHistoryUsageByLaserCustomerId);
router.post("/purchase-customer", purchasePackageForCustomer);

// NEW: Settle a visit by deducting from an existing package (POST)
router.post("/settle-visit", settleVisitWithPackage);
export default router;
