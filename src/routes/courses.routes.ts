import { Router } from "express";
import {
  answerPracticeQuestion,
  createCourse,
  createQuestion,
  deleteCourse,
  deletePractice,
  getCourse,
  getCourses,
  getCoursesAccess,
  getPractice,
  getPractices,
  getQuestions,
  importQuestions,
  startPractice,
  updateCourse,
  updateQuestion,
} from "../controllers/courses.controller";
import { requireCoursesAccess } from "../middleware/coursesAccess";
import { authenticate } from "../middleware/auth";
import { enforceDevice } from "../middleware/enforceDevice";

const router = Router();

router.use(authenticate, enforceDevice);
router.get("/access", getCoursesAccess);
router.use(requireCoursesAccess);

router.get("/", getCourses);
router.post("/", createCourse);
router.get("/practices", getPractices);
router.get("/practices/:practiceId", getPractice);
router.post("/practices/:practiceId/answer", answerPracticeQuestion);
router.delete("/practices/:practiceId", deletePractice);
router.get("/:courseId", getCourse);
router.patch("/:courseId", updateCourse);
router.delete("/:courseId", deleteCourse);
router.get("/:courseId/questions", getQuestions);
router.post("/:courseId/questions", createQuestion);
router.post("/:courseId/questions/import", importQuestions);
router.patch("/:courseId/questions/:questionId", updateQuestion);
router.post("/:courseId/practices", startPractice);

export default router;
