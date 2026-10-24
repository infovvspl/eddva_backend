import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires the old school study planner (replaced by the AI learning path).
 *
 * - school_quiz_attempts -> learning_legacy_quiz_attempts: past AI-quiz
 *   attempts still count as evidence for weak-topic detection, so the data is
 *   kept under the learning path's name.
 * - school_study_plans, school_plan_items, school_topic_progress ->
 *   archive_*: nothing reads them any more. Renamed, not dropped, so the data
 *   stays in the database as the backup; `down` restores them. Drop the
 *   archive_* tables in a later release once nobody needs them.
 *
 * Each table is moved only if it exists and its new name is free, so the
 * migration also runs on databases where the old planner never started.
 */
const MOVES: [string, string][] = [
  ['school_quiz_attempts', 'learning_legacy_quiz_attempts'],
  ['school_plan_items', 'archive_school_plan_items'],
  ['school_study_plans', 'archive_school_study_plans'],
  ['school_topic_progress', 'archive_school_topic_progress'],
];

async function rename(queryRunner: QueryRunner, from: string, to: string) {
  const [state] = await queryRunner.query(`SELECT to_regclass($1) AS src, to_regclass($2) AS dst`, [`public.${from}`, `public.${to}`]);
  if (state?.src && !state?.dst) await queryRunner.query(`ALTER TABLE ${from} RENAME TO ${to}`);
}

export class RetireOldStudyPlanner1792600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [from, to] of MOVES) await rename(queryRunner, from, to);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [from, to] of [...MOVES].reverse()) await rename(queryRunner, to, from);
  }
}
