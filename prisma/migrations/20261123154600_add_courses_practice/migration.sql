CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseQuestion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "question_image" TEXT,
    "options" JSONB NOT NULL,
    "correct_answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoursePractice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "CoursePractice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoursePracticeQuestion" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "selectedAnswer" TEXT,
    "isCorrect" BOOLEAN,
    "answeredAt" TIMESTAMP(3),
    CONSTRAINT "CoursePracticeQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Course_userId_createdAt_idx" ON "Course"("userId", "createdAt");
CREATE INDEX "CourseQuestion_courseId_createdAt_idx" ON "CourseQuestion"("courseId", "createdAt");
CREATE INDEX "CoursePractice_userId_startedAt_idx" ON "CoursePractice"("userId", "startedAt");
CREATE INDEX "CoursePractice_courseId_startedAt_idx" ON "CoursePractice"("courseId", "startedAt");
CREATE UNIQUE INDEX "CoursePracticeQuestion_practiceId_position_key" ON "CoursePracticeQuestion"("practiceId", "position");
CREATE UNIQUE INDEX "CoursePracticeQuestion_practiceId_questionId_key" ON "CoursePracticeQuestion"("practiceId", "questionId");

ALTER TABLE "Course" ADD CONSTRAINT "Course_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseQuestion" ADD CONSTRAINT "CourseQuestion_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePractice" ADD CONSTRAINT "CoursePractice_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePractice" ADD CONSTRAINT "CoursePractice_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePracticeQuestion" ADD CONSTRAINT "CoursePracticeQuestion_practiceId_fkey"
    FOREIGN KEY ("practiceId") REFERENCES "CoursePractice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePracticeQuestion" ADD CONSTRAINT "CoursePracticeQuestion_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "CourseQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
