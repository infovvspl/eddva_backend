const axios = require('axios');

async function testCreate() {
  try {
    // 1. Try to hit the assignment creation endpoint directly (it will fail with 401 Unauthorized, but maybe we can mock a request)
    // Actually, let's just make a script that imports AssignmentModule and runs AssignmentService
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('./dist/app.module');
    const { AssignmentService } = require('./dist/modules/assignment/assignment.service');
    
    const app = await NestFactory.createApplicationContext(AppModule);
    const service = app.get(AssignmentService);
    
    try {
      await service.createAssignment("some-tenant", "7e125cc4-4c20-4914-b9b8-4979cbab290c", {
        title: "Test Assignment",
        description: "Test description",
        maxMarks: 100
      });
      console.log("Create succeeded!");
    } catch (e) {
      console.error("Create failed with error:", e);
    }
    await app.close();
  } catch (err) {
    console.error("Bootstrap error:", err);
  }
}

testCreate();
