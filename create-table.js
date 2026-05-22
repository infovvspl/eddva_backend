const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { DataSource } = require('typeorm');

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  const query = `
    CREATE TABLE IF NOT EXISTS "batch_feedbacks" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "created_at" TIMESTAMP NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
      "deleted_at" TIMESTAMP,
      "tenant_id" uuid NOT NULL,
      "student_id" uuid NOT NULL,
      "batch_id" uuid NOT NULL,
      "rating" integer NOT NULL,
      "comment" text,
      CONSTRAINT "UQ_batch_feedback_student" UNIQUE ("student_id", "batch_id"),
      CONSTRAINT "PK_batch_feedbacks_id" PRIMARY KEY ("id")
    );
  `;
  try {
    await dataSource.query(query);
    console.log("Table batch_feedbacks created successfully!");
  } catch (e) {
    console.error("Failed to create table", e);
  }

  await app.close();
}

run();
