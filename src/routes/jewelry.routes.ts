import { Router } from "express";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  listDemoPhotos,
  getDemoPhoto,
  createDemoPhoto,
  updateDemoPhoto,
  deleteDemoPhoto,
} from "../controllers/jewelry.controller";
import { authenticate, authorize } from "../middleware/auth";
import { enforceDevice } from "../middleware/enforceDevice";

const router = Router();

// Public, read-only: used by the showcase web app.
router.get("/categories", listCategories);
router.get("/items", listItems);
router.get("/items/:id", getItem);
router.get("/demo-photos", listDemoPhotos);
router.get("/demo-photos/:id", getDemoPhoto);

// Admin portal (mobile app).
const admin = Router();
admin.use(authenticate, enforceDevice, authorize(["admin"]));

admin.post("/categories", createCategory);
admin.patch("/categories/:id", updateCategory);
admin.delete("/categories/:id", deleteCategory);

admin.post("/items", createItem);
admin.patch("/items/:id", updateItem);
admin.delete("/items/:id", deleteItem);

admin.post("/demo-photos", createDemoPhoto);
admin.patch("/demo-photos/:id", updateDemoPhoto);
admin.delete("/demo-photos/:id", deleteDemoPhoto);

router.use("/admin", admin);

export default router;
