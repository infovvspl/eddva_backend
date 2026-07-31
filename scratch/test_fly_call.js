const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { SchoolAssessmentService } = require('../dist/modules/school/assessment/school-assessment.service');

async function testFly() {
  console.log("Bootstrapping NestJS application...");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  console.log("NestJS booted.");
  
  const svc = app.get(SchoolAssessmentService);

  // We mock a teacher user
  const mockUser = {
    id: "2ae328a5-264c-42e5-8b04-20adda014954",
    email: "neha@gmail.com",
    name: "Neha Sharma",
    role: "TEACHER",
    instituteId: "c259cd4e-b018-45e2-8e46-52a497ca49a1",
    inst_ai_enabled: true,
    inst_ai_features: {
      ai_doubt_solver: true,
      ai_notes_generator: true,
      ai_quiz_generator: true,
      ai_study_planner: true,
      ai_career_guidance: true,
      ai_ocr_handwriting: true,
      ai_subjective_grading: true
    }
  };

  const assessmentId = "73503dc7-dc3a-4d84-a7dc-c39ba7243d00";
  const studentUserId = "b49ee8d3-4c33-448c-aa06-30dc8bfbee54";

  try {
    console.log("Calling getSubmissionForReview...");
    const res = await svc.getSubmissionForReview(mockUser, assessmentId, studentUserId, {});
    console.log("RESULT RECEIVED:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("ERROR ENCOUNTERED:", err);
  } finally {
    await app.close();
  }
}

testFly();
