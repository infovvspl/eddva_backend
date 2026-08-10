import { DataSource } from 'typeorm';
import { schoolDbConfig } from './src/config/database.config';
import { SchoolDocumentTemplate } from './src/modules/school/entities/school-document-template.entity';

async function run() {
  const config = { ...schoolDbConfig, synchronize: false };
  const ds = new DataSource(config as any);
  await ds.initialize();
  
  await ds.query(`DROP TABLE IF EXISTS "school_document_templates" CASCADE`);
  await ds.query(`DROP TABLE IF EXISTS "school_document_generation_history" CASCADE`);
  await ds.query(`DROP TABLE IF EXISTS "id_card_records" CASCADE`);
  
  await ds.query(`
    CREATE TABLE IF NOT EXISTS "school_document_templates" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "created_at" TIMESTAMP NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
      "type" character varying NOT NULL,
      "name" character varying(255) NOT NULL,
      "html_content" text NOT NULL,
      "dimensions" jsonb,
      "is_active" boolean NOT NULL DEFAULT true,
      CONSTRAINT "PK_school_document_templates" PRIMARY KEY ("id")
    );
  `);
  
  await ds.query(`
    CREATE TABLE IF NOT EXISTS "school_document_generation_history" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "created_at" TIMESTAMP NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
      "document_type" character varying NOT NULL,
      "generated_for" character varying NOT NULL,
      "target_id" uuid NOT NULL,
      "generated_by" uuid NOT NULL,
      "file_url" character varying(1024),
      CONSTRAINT "PK_school_document_generation_history" PRIMARY KEY ("id")
    );
  `);

  await ds.query(`
    CREATE TABLE IF NOT EXISTS "id_card_records" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "created_at" TIMESTAMP NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
      "deleted_at" TIMESTAMP,
      "target_type" character varying NOT NULL,
      "target_id" uuid NOT NULL,
      "document_type" character varying NOT NULL,
      "qr_code_hash" character varying(128) NOT NULL,
      "status" character varying NOT NULL DEFAULT 'ACTIVE',
      "issued_at" TIMESTAMP NOT NULL DEFAULT now(),
      "reissued_at" TIMESTAMP,
      "file_url" character varying(1024),
      CONSTRAINT "UQ_qr_code_hash" UNIQUE ("qr_code_hash"),
      CONSTRAINT "PK_id_card_records" PRIMARY KEY ("id")
    );
  `);

  const repo = ds.getRepository(SchoolDocumentTemplate);
  
  const idCardHtml = `
    <div style="width: 54mm; height: 86mm; border: 1px solid #ccc; border-radius: 8px; padding: 10px; font-family: 'Inter', sans-serif; box-sizing: border-box; background: linear-gradient(135deg, #f0f4ff, #ffffff); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="text-align: center; margin-bottom: 10px;">
        <h3 style="margin: 0; color: #1e3a8a; font-size: 14px; font-weight: 700;">EDDVA Academy</h3>
        <p style="margin: 0; font-size: 10px; color: #64748b;">Student Identity Card</p>
      </div>
      <div style="text-align: center; margin-bottom: 12px;">
        <div style="width: 60px; height: 60px; background: #e2e8f0; border-radius: 50%; margin: 0 auto; border: 2px solid #3b82f6; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <span style="color: #94a3b8; font-size: 20px;">👤</span>
        </div>
      </div>
      <div style="font-size: 11px; color: #334155; line-height: 1.6;">
        <p style="margin: 2px 0;"><strong>Name:</strong> {{firstName}} {{lastName}}</p>
        <p style="margin: 2px 0;"><strong>Roll No:</strong> {{rollNo}}</p>
        <p style="margin: 2px 0;"><strong>DOB:</strong> {{dob}}</p>
        <p style="margin: 2px 0;"><strong>Blood Grp:</strong> <span style="color: #ef4444; font-weight: bold;">{{bloodGroup}}</span></p>
      </div>
      <div style="text-align: center; margin-top: 10px;">
        <img src="{{qrCode}}" alt="QR" style="width: 40px; height: 40px;" />
      </div>
      <div style="margin-top: 5px; border-top: 1px dashed #cbd5e1; padding-top: 5px; text-align: center;">
        <p style="margin: 0; font-size: 9px; color: #94a3b8;">Valid for academic year 2026-27</p>
      </div>
    </div>
  `;

  const admitCardHtml = `
    <div style="width: 148mm; height: 210mm; border: 2px solid #1e40af; padding: 25px; font-family: 'Inter', sans-serif; box-sizing: border-box; background: #ffffff; position: relative;">
      
      <div style="position: absolute; top: 0; left: 0; width: 100%; height: 8px; background: #1e40af;"></div>

      <div style="text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px; margin-bottom: 25px; margin-top: 10px;">
        <h2 style="margin: 0; color: #1e40af; font-size: 24px; text-transform: uppercase; letter-spacing: 1px;">EDDVA Academy</h2>
        <h4 style="margin: 8px 0 0 0; color: #475569; font-weight: 500;">Examination Admit Card</h4>
      </div>
      
      <div style="display: flex; justify-content: space-between; margin-bottom: 30px;">
        <div style="font-size: 14px; line-height: 2; color: #1e293b;">
          <p style="margin: 0;"><strong>Candidate Name:</strong> {{firstName}} {{lastName}}</p>
          <p style="margin: 0;"><strong>Examination:</strong> {{examName}}</p>
          <p style="margin: 0;"><strong>Exam Center:</strong> {{center}}</p>
        </div>
        <div style="width: 100px; height: 120px; border: 2px dashed #cbd5e1; border-radius: 4px; text-align: center; line-height: 120px; color: #94a3b8; font-size: 12px; background: #f8fafc;">
          Affix Photo
        </div>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 13px;">
        <thead>
          <tr style="background: #f1f5f9;">
            <th style="border: 1px solid #cbd5e1; padding: 12px 8px; text-align: left; color: #334155;">Date</th>
            <th style="border: 1px solid #cbd5e1; padding: 12px 8px; text-align: left; color: #334155;">Subject</th>
            <th style="border: 1px solid #cbd5e1; padding: 12px 8px; text-align: left; color: #334155;">Time</th>
            <th style="border: 1px solid #cbd5e1; padding: 12px 8px; text-align: left; color: #334155;">Invigilator Sign</th>
          </tr>
        </thead>
        <tbody style="color: #475569;">
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 10px 8px;">10-Oct-2026</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px 8px;">Mathematics</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px 8px;">10:00 AM - 01:00 PM</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px 8px;"></td>
          </tr>
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 10px 8px;">12-Oct-2026</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px 8px;">Physics</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px 8px;">10:00 AM - 01:00 PM</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px 8px;"></td>
          </tr>
        </tbody>
      </table>
      
      <div style="font-size: 12px; color: #64748b; background: #f8fafc; padding: 15px; border-radius: 6px;">
        <p style="margin: 0 0 8px 0; color: #334155;"><strong>Important Instructions:</strong></p>
        <ul style="margin: 0; padding-left: 20px; line-height: 1.6;">
          <li>Bring this admit card and original school ID to the examination hall daily.</li>
          <li>Electronic devices (mobile phones, smartwatches) are strictly prohibited.</li>
          <li>Report 30 minutes before the scheduled time. No entry after exam starts.</li>
        </ul>
      </div>
    </div>
  `;

  await repo.save({
    type: 'ID_CARD_STUDENT' as any,
    name: 'Standard Student ID Card (Blue Theme)',
    htmlContent: idCardHtml,
    dimensions: { width: 54, height: 86 },
    isActive: true,
  });

  await repo.save({
    type: 'ADMIT_CARD' as any,
    name: 'Standard A5 Admit Card',
    htmlContent: admitCardHtml,
    dimensions: { width: 148, height: 210 },
    isActive: true,
  });

  console.log('Templates seeded successfully!');
  await ds.destroy();
}

run().catch(console.error);
