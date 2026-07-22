import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreatedAtToBroadcastPollVotes1783426548253 implements MigrationInterface {
    name = 'AddCreatedAtToBroadcastPollVotes1783426548253'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "broadcast_poll_votes" 
            ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "broadcast_poll_votes" 
            DROP COLUMN IF EXISTS "created_at"
        `);
    }
}
