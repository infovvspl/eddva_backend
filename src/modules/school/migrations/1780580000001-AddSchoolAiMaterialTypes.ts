import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchoolAiMaterialTypes1780580000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const types = [
      'ebook',
      'study_guide',
      'key_concepts',
      'flashcard',
      'revision_checklist',
      'faq',
    ];
    for (const type of types) {
      await queryRunner.query(`ALTER TYPE study_materials_type_enum ADD VALUE IF NOT EXISTS '${type}'`);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot safely remove enum values while rows may still use them.
  }
}
