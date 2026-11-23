import { Prisma, PrismaClient } from "@prisma/client";
import { Request, Response } from "express";

const prisma = new PrismaClient();

interface QuestionInput {
  question: string;
  question_image?: string | null;
  options: string[];
  correct_answer: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseQuestion = (value: unknown): QuestionInput | null => {
  if (!isRecord(value)) return null;

  const { question, question_image, options, correct_answer } = value;
  if (
    typeof question !== "string" ||
    !question.trim() ||
    !Array.isArray(options) ||
    options.length < 2 ||
    !options.every((option) => typeof option === "string" && option.trim()) ||
    typeof correct_answer !== "string" ||
    !options.includes(correct_answer)
  ) {
    return null;
  }
  if (
    question_image !== undefined &&
    question_image !== null &&
    typeof question_image !== "string"
  ) {
    return null;
  }

  return {
    question: question.trim(),
    question_image: question_image || null,
    options: options as string[],
    correct_answer,
  };
};

const getUserId = (req: Request): string | undefined =>
  (req as any).user?.userId;

const handleError = (
  res: Response,
  error: unknown,
  logMessage: string,
  responseMessage: string,
) => {
  console.error(logMessage, error);
  return res.status(500).json({ message: responseMessage });
};

export const getCoursesAccess = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    return res.json({
      available: user.email.toLowerCase().includes("walker"),
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "Failed to check Courses access",
      "Failed to check feature access",
    );
  }
};

export const getCourses = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const courses = await prisma.course.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { questions: true } } },
    });
    return res.json(courses);
  } catch (error) {
    return handleError(res, error, "Failed to fetch courses", "Failed to fetch courses");
  }
};

export const createCourse = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { name, image } = (req.body ?? {}) as {
    name?: unknown;
    image?: unknown;
  };
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ message: "name is required" });
  }
  if (image !== undefined && image !== null && typeof image !== "string") {
    return res.status(400).json({ message: "image must be a string or null" });
  }

  try {
    const course = await prisma.course.create({
      data: { userId, name: name.trim(), image: image || null },
    });
    return res.status(201).json(course);
  } catch (error) {
    return handleError(res, error, "Failed to create course", "Failed to create course");
  }
};

export const getCourse = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const course = await prisma.course.findFirst({
      where: { id: req.params.courseId, userId },
      include: { questions: { orderBy: { createdAt: "asc" } } },
    });
    if (!course) return res.status(404).json({ message: "Course not found" });
    return res.json(course);
  } catch (error) {
    return handleError(res, error, "Failed to fetch course", "Failed to fetch course");
  }
};

export const updateCourse = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { name, image } = (req.body ?? {}) as {
    name?: unknown;
    image?: unknown;
  };
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ message: "name must be a non-empty string" });
  }
  if (image !== undefined && image !== null && typeof image !== "string") {
    return res.status(400).json({ message: "image must be a string or null" });
  }
  if (name === undefined && image === undefined) {
    return res.status(400).json({ message: "At least one field is required" });
  }

  try {
    const result = await prisma.course.updateMany({
      where: { id: req.params.courseId, userId },
      data: {
        ...(name !== undefined ? { name: (name as string).trim() } : {}),
        ...(image !== undefined ? { image: image as string | null } : {}),
      },
    });
    if (!result.count) return res.status(404).json({ message: "Course not found" });
    const course = await prisma.course.findUnique({
      where: { id: req.params.courseId },
    });
    return res.json(course);
  } catch (error) {
    return handleError(res, error, "Failed to update course", "Failed to update course");
  }
};

export const deleteCourse = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const result = await prisma.course.deleteMany({
      where: { id: req.params.courseId, userId },
    });
    if (!result.count) return res.status(404).json({ message: "Course not found" });
    return res.status(204).send();
  } catch (error) {
    return handleError(res, error, "Failed to delete course", "Failed to delete course");
  }
};

export const getQuestions = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const course = await prisma.course.findFirst({
      where: { id: req.params.courseId, userId },
      select: { id: true },
    });
    if (!course) return res.status(404).json({ message: "Course not found" });

    const questions = await prisma.courseQuestion.findMany({
      where: { courseId: course.id },
      orderBy: { createdAt: "asc" },
    });
    return res.json(questions);
  } catch (error) {
    return handleError(res, error, "Failed to fetch questions", "Failed to fetch questions");
  }
};

export const createQuestion = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const question = parseQuestion(req.body);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!question) {
    return res.status(400).json({
      message:
        "A question needs text, at least two string options, and a correct_answer matching one option",
    });
  }

  try {
    const course = await prisma.course.findFirst({
      where: { id: req.params.courseId, userId },
      select: { id: true },
    });
    if (!course) return res.status(404).json({ message: "Course not found" });

    const createdQuestion = await prisma.courseQuestion.create({
      data: {
        ...question,
        options: question.options as Prisma.InputJsonValue,
        courseId: course.id,
      },
    });
    return res.status(201).json(createdQuestion);
  } catch (error) {
    return handleError(res, error, "Failed to create question", "Failed to create question");
  }
};

export const importQuestions = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { questions } = (req.body ?? {}) as { questions?: unknown };
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (
    !Array.isArray(questions) ||
    questions.length === 0 ||
    questions.length > 1000
  ) {
    return res.status(400).json({
      message: "questions must be an array containing between 1 and 1000 items",
    });
  }
  const parsedQuestions = questions.map(parseQuestion);
  if (parsedQuestions.some((question) => question === null)) {
    return res.status(400).json({
      message:
        "Every question needs text, at least two string options, and a correct_answer matching one option",
    });
  }

  try {
    const course = await prisma.course.findFirst({
      where: { id: req.params.courseId, userId },
      select: { id: true },
    });
    if (!course) return res.status(404).json({ message: "Course not found" });

    const result = await prisma.courseQuestion.createMany({
      data: (parsedQuestions as QuestionInput[]).map((question) => ({
        ...question,
        options: question.options as Prisma.InputJsonValue,
        courseId: course.id,
      })),
    });
    return res.status(201).json({ imported: result.count });
  } catch (error) {
    return handleError(res, error, "Failed to import questions", "Failed to import questions");
  }
};

export const updateQuestion = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const updates = req.body as Record<string, unknown>;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!isRecord(updates) || Object.keys(updates).length === 0) {
    return res.status(400).json({ message: "At least one field is required" });
  }
  if (
    Object.keys(updates).some(
      (field) =>
        !["question", "question_image", "options", "correct_answer"].includes(
          field,
        ),
    )
  ) {
    return res.status(400).json({ message: "Unsupported question field" });
  }

  try {
    const existing = await prisma.courseQuestion.findFirst({
      where: {
        id: req.params.questionId,
        courseId: req.params.courseId,
        course: { userId },
      },
    });
    if (!existing) return res.status(404).json({ message: "Question not found" });

    const merged = parseQuestion({
      question: updates.question ?? existing.question,
      question_image:
        updates.question_image !== undefined
          ? updates.question_image
          : existing.question_image,
      options: updates.options ?? existing.options,
      correct_answer: updates.correct_answer ?? existing.correct_answer,
    });
    if (!merged) {
      return res.status(400).json({
        message:
          "The updated question needs text, at least two string options, and a correct_answer matching one option",
      });
    }

    const updated = await prisma.courseQuestion.update({
      where: { id: existing.id },
      data: {
        ...merged,
        options: merged.options as Prisma.InputJsonValue,
      },
    });
    return res.json(updated);
  } catch (error) {
    return handleError(res, error, "Failed to update question", "Failed to update question");
  }
};

export const startPractice = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { questionCount } = (req.body ?? {}) as {
    questionCount?: unknown;
  };
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!Number.isInteger(questionCount) || (questionCount as number) < 1) {
    return res.status(400).json({ message: "questionCount must be a positive integer" });
  }

  try {
    const course = await prisma.course.findFirst({
      where: { id: req.params.courseId, userId },
      select: { id: true },
    });
    if (!course) return res.status(404).json({ message: "Course not found" });

    const questions = await prisma.courseQuestion.findMany({
      where: { courseId: course.id },
      select: { id: true },
    });
    if (questions.length === 0) {
      return res.status(400).json({ message: "Course has no questions" });
    }
    if ((questionCount as number) > questions.length) {
      return res.status(400).json({
        message: `questionCount cannot exceed the ${questions.length} questions in this course`,
      });
    }

    const shuffledIds = questions.map(({ id }) => id);
    for (let index = shuffledIds.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffledIds[index], shuffledIds[swapIndex]] = [
        shuffledIds[swapIndex],
        shuffledIds[index],
      ];
    }

    const practice = await prisma.coursePractice.create({
      data: {
        userId,
        courseId: course.id,
        questions: {
          create: shuffledIds
            .slice(0, questionCount as number)
            .map((questionId, position) => ({ questionId, position })),
        },
      },
      select: { id: true, courseId: true, startedAt: true, currentIndex: true },
    });
    return res.status(201).json({
      ...practice,
      totalQuestions: questionCount,
    });
  } catch (error) {
    return handleError(res, error, "Failed to start practice", "Failed to start practice");
  }
};

export const getPractices = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const practices = await prisma.coursePractice.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 100,
      include: {
        course: { select: { id: true, name: true, image: true } },
        questions: { select: { isCorrect: true } },
      },
    });
    return res.json(
      practices.map(({ questions, ...practice }) => {
        const total = questions.length;
        const correct = questions.filter(({ isCorrect }) => isCorrect === true).length;
        const complete = practice.completedAt !== null;
        return {
          ...practice,
          totalQuestions: total,
          answeredQuestions: questions.filter(({ isCorrect }) => isCorrect !== null)
            .length,
          rating: complete
            ? {
                correct,
                total,
                percentage: total ? Math.round((correct / total) * 100) : 0,
              }
            : null,
        };
      }),
    );
  } catch (error) {
    return handleError(res, error, "Failed to fetch practices", "Failed to fetch practices");
  }
};

export const getPractice = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const practice = await prisma.coursePractice.findFirst({
      where: { id: req.params.practiceId, userId },
      include: {
        course: { select: { id: true, name: true, image: true } },
        questions: {
          orderBy: { position: "asc" },
          include: { question: true },
        },
      },
    });
    if (!practice) return res.status(404).json({ message: "Practice not found" });

    const total = practice.questions.length;
    const correct = practice.questions.filter(({ isCorrect }) => isCorrect === true)
      .length;
    return res.json({
      id: practice.id,
      course: practice.course,
      startedAt: practice.startedAt,
      completedAt: practice.completedAt,
      currentIndex: practice.currentIndex,
      totalQuestions: total,
      rating:
        practice.completedAt === null
          ? null
          : {
              correct,
              total,
              percentage: total ? Math.round((correct / total) * 100) : 0,
            },
      questions: practice.questions.map((item) => ({
        id: item.question.id,
        question: item.question.question,
        question_image: item.question.question_image,
        options: item.question.options,
        position: item.position,
        selectedAnswer: item.selectedAnswer,
        isCorrect: item.isCorrect,
        correct_answer:
          item.isCorrect !== null ? item.question.correct_answer : undefined,
      })),
    });
  } catch (error) {
    return handleError(res, error, "Failed to fetch practice", "Failed to fetch practice");
  }
};

export const answerPracticeQuestion = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { questionId, answer   } = (req.body ?? {}) as {
    questionId?: unknown;
    answer?: unknown;
  };
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (typeof questionId !== "string" || typeof answer !== "string") {
    return res.status(400).json({ message: "questionId and answer are required" });
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const practice = await transaction.coursePractice.findFirst({
        where: { id: req.params.practiceId, userId },
        select: { id: true, currentIndex: true, completedAt: true },
      });
      if (!practice) return { status: 404 as const };
      if (practice.completedAt) return { status: 409 as const };

      const item = await transaction.coursePracticeQuestion.findFirst({
        where: { practiceId: practice.id, position: practice.currentIndex },
        include: { question: true },
      });
      if (!item || item.questionId !== questionId) {
        return { status: 409 as const };
      }

      const options = item.question.options;
      if (
        !Array.isArray(options) ||
        !options.every((option): option is string => typeof option === "string") ||
        !options.includes(answer)
      ) {
        return { status: 400 as const };
      }

      const isCorrect = answer === item.question.correct_answer;
      const update = await transaction.coursePracticeQuestion.updateMany({
        where: {
          id: item.id,
          selectedAnswer: null,
        },
        data: { selectedAnswer: answer, isCorrect, answeredAt: new Date() },
      });
      if (update.count === 0) return { status: 409 as const };

      const total = await transaction.coursePracticeQuestion.count({
        where: { practiceId: practice.id },
      });
      const isComplete = practice.currentIndex + 1 === total;
      await transaction.coursePractice.update({
        where: { id: practice.id },
        data: {
          currentIndex: { increment: 1 },
          ...(isComplete ? { completedAt: new Date() } : {}),
        },
      });

      const correctCount = await transaction.coursePracticeQuestion.count({
        where: { practiceId: practice.id, isCorrect: true },
      });
      return {
        status: 200 as const,
        isCorrect,
        correct_answer: item.question.correct_answer,
        selectedAnswer: answer,
        currentIndex: practice.currentIndex + 1,
        isComplete,
        rating: isComplete
          ? {
              correct: correctCount,
              total,
              percentage: Math.round((correctCount / total) * 100),
            }
          : null,
      };
    });

    if (result.status === 404) {
      return res.status(404).json({ message: "Practice not found" });
    }
    if (result.status === 400) {
      return res.status(400).json({ message: "answer must match one of the options" });
    }
    if (result.status === 409) {
      return res.status(409).json({
        message: "This question is not the current unanswered question",
      });
    }
    const { status, ...response } = result;
    return res.json(response);
  } catch (error) {
    return handleError(
      res,
      error,
      "Failed to save practice answer",
      "Failed to save practice answer",
    );
  }
};

export const deletePractice = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const result = await prisma.coursePractice.deleteMany({
      where: { id: req.params.practiceId, userId },
    });
    if (!result.count) return res.status(404).json({ message: "Practice not found" });
    return res.status(204).send();
  } catch (error) {
    return handleError(res, error, "Failed to delete practice", "Failed to delete practice");
  }
};
