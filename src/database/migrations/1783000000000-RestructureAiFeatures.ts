import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestructureAiFeatures1783000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const tenants = await queryRunner.query(`SELECT id, ai_features FROM tenants`);

    for (const t of tenants) {
      if (!t.ai_features) continue;

      let currentFeatures: string[] = [];
      if (typeof t.ai_features === 'string') {
        try {
          currentFeatures = JSON.parse(t.ai_features);
        } catch {
          continue;
        }
      } else if (Array.isArray(t.ai_features)) {
        currentFeatures = t.ai_features;
      } else {
        continue;
      }

      const newFeatures = new Set<string>();

      if (currentFeatures.some(f => ['ai_speech_to_text', 'ai_notes_image_enrichment', 'multilingual_translation'].includes(f))) {
        newFeatures.add('ai_lecture_processing');
      }
      
      if (currentFeatures.some(f => ['ai_study_assistant', 'ai_study_plan'].includes(f))) {
        newFeatures.add('ai_learning_assistant');
      }
      
      if (currentFeatures.some(f => ['ai_doubt_resolution', 'image_ocr_handwriting'].includes(f))) {
        newFeatures.add('ai_doubt_solver');
      }
      
      if (currentFeatures.includes('ai_analytics')) {
        newFeatures.add('ai_student_insights');
      }
      
      if (currentFeatures.includes('image_ocr_handwriting')) {
        newFeatures.add('ai_assessment_grading');
      }
      
      if (currentFeatures.includes('ai_content_generation')) {
        newFeatures.add('ai_content_generation');
      }
      
      if (currentFeatures.includes('ai_battle_arena')) {
        newFeatures.add('ai_battle_arena');
      }

      const updatedFeaturesJson = JSON.stringify(Array.from(newFeatures));
      
      await queryRunner.query(`UPDATE tenants SET ai_features = $1 WHERE id = $2`, [updatedFeaturesJson, t.id]);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // There is no exact reverse mapping because we lose the granularity of the old keys. 
    // We will leave the down migration empty or throw an error to prevent accidental data loss.
    // However, to keep it reversible in a basic sense, we can do nothing, or map them back broadly.
    // Given the scope of restructuring, returning to exact previous state would require a backup.
  }
}
