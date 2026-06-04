const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { DataSource } = require('typeorm');

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  try {
    console.log("Creating lecture_assignments table...");
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS "lecture_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(), 
        "created_at" TIMESTAMP NOT NULL DEFAULT now(), 
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(), 
        "deleted_at" TIMESTAMP, 
        "tenant_id" character varying NOT NULL, 
        "lecture_id" uuid NOT NULL, 
        "title" character varying NOT NULL, 
        "description" text, 
        "attachment_url" character varying, 
        "due_date" TIMESTAMP WITH TIME ZONE, 
        "max_marks" integer, 
        CONSTRAINT "PK_24c8b322c0b742743ef5f996866" PRIMARY KEY ("id")
      )
    `);

    console.log("Creating assignment_submissions_status_enum...");
    try {
      await dataSource.query(`CREATE TYPE "public"."assignment_submissions_status_enum" AS ENUM('submitted', 'graded', 'late')`);
    } catch (e) {
      console.log("Enum might already exist", e.message);
    }

    console.log("Creating assignment_submissions table...");
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS "assignment_submissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(), 
        "created_at" TIMESTAMP NOT NULL DEFAULT now(), 
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(), 
        "deleted_at" TIMESTAMP, 
        "tenant_id" character varying NOT NULL, 
        "assignment_id" uuid NOT NULL, 
        "student_id" uuid NOT NULL, 
        "submission_url" character varying NOT NULL, 
        "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), 
        "status" "public"."assignment_submissions_status_enum" NOT NULL DEFAULT 'submitted', 
        "grade" double precision, 
        "feedback" text, 
        CONSTRAINT "PK_0caedc49d0357bedac05ca5a806" PRIMARY KEY ("id")
      )
    `);

    console.log("Tables created successfully!");
  } catch (e) {
    console.error("DB Error:", e);
  }

  await app.close();
}

run();
