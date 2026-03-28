import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeacherProfiles1700000000003 implements MigrationInterface {
  name = 'TeacherProfiles1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "teacher_profiles" (
        "id"                   UUID NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"           TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at"           TIMESTAMP,
        "user_id"              UUID NOT NULL,
        "tenant_id"            UUID NOT NULL,
        "qualification"        VARCHAR,
        "subject_expertise"    JSONB NOT NULL DEFAULT '[]',
        "classes_teach"        JSONB NOT NULL DEFAULT '[]',
        "years_of_experience"  INTEGER,
        "bio"                  TEXT,
        "gender"               VARCHAR,
        "date_of_birth"        DATE,
        "profile_photo_url"    VARCHAR,
        "teaching_mode"        VARCHAR,
        "previous_institute"   VARCHAR,
        "city"                 VARCHAR,
        "state"                VARCHAR,
        "onboarding_complete"  BOOLEAN NOT NULL DEFAULT false,
        CONSTRAINT "PK_teacher_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_teacher_profiles_user_id" UNIQUE ("user_id"),
        CONSTRAINT "FK_teacher_profiles_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "teacher_profiles"`);
  }
}
