import { MigrationInterface, QueryRunner } from "typeorm";

export class SprintDMaterialArchitecture1780470627458 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE study_materials ADD COLUMN subject_id_fk UUID NULL;
            ALTER TABLE study_materials ADD COLUMN chapter_id UUID NULL;
            ALTER TABLE study_materials ADD COLUMN topic_id UUID NULL;

            ALTER TABLE study_materials ADD CONSTRAINT fk_study_materials_subject FOREIGN KEY (subject_id_fk) REFERENCES subjects(id) ON DELETE SET NULL;
            ALTER TABLE study_materials ADD CONSTRAINT fk_study_materials_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL;
            ALTER TABLE study_materials ADD CONSTRAINT fk_study_materials_topic FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL;

            CREATE INDEX idx_study_materials_subject_id ON study_materials(subject_id_fk);
            CREATE INDEX idx_study_materials_chapter_id ON study_materials(chapter_id);
            CREATE INDEX idx_study_materials_topic_id ON study_materials(topic_id);

            CREATE INDEX idx_study_materials_curriculum ON study_materials(subject_id_fk, chapter_id, topic_id);
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX IF EXISTS idx_study_materials_curriculum;
            DROP INDEX IF EXISTS idx_study_materials_topic_id;
            DROP INDEX IF EXISTS idx_study_materials_chapter_id;
            DROP INDEX IF EXISTS idx_study_materials_subject_id;
            
            ALTER TABLE study_materials DROP CONSTRAINT IF EXISTS fk_study_materials_topic;
            ALTER TABLE study_materials DROP CONSTRAINT IF EXISTS fk_study_materials_chapter;
            ALTER TABLE study_materials DROP CONSTRAINT IF EXISTS fk_study_materials_subject;
            
            ALTER TABLE study_materials DROP COLUMN IF EXISTS topic_id;
            ALTER TABLE study_materials DROP COLUMN IF EXISTS chapter_id;
            ALTER TABLE study_materials DROP COLUMN IF EXISTS subject_id_fk;
        `);
    }
}
