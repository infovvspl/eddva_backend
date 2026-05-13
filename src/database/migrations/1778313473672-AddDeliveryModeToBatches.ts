import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddDeliveryModeToBatches1778313473672 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create enum type
        await queryRunner.query(`CREATE TYPE "public"."batch_delivery_mode_enum" AS ENUM('live', 'hybrid', 'recorded')`);
        
        // Add column
        await queryRunner.addColumn(
            "batches",
            new TableColumn({
                name: "delivery_mode",
                type: "enum",
                enum: ['live', 'hybrid', 'recorded'],
                enumName: "batch_delivery_mode_enum",
                default: "'hybrid'",
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("batches", "delivery_mode");
        await queryRunner.query(`DROP TYPE "public"."batch_delivery_mode_enum"`);
    }

}
