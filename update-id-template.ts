import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchoolDocumentTemplate } from './src/modules/school/entities/school-document-template.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo = app.get(getRepositoryToken(SchoolDocumentTemplate, 'school'));
  
  const idCardHtml = `
    <div style="display: flex; gap: 15px; font-family: 'Inter', sans-serif; margin: 0 auto;">
      
      <!-- FRONT SIDE -->
      <div style="width: 54mm; height: 86mm; border: 1px solid #cbd5e1; border-radius: 8px; box-sizing: border-box; background: #ffffff; position: relative; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        <!-- Header -->
        <div style="background: #1e3a8a; color: white; text-align: center; padding: 10px 5px; height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
           {{#if schoolLogo}}
             <img src="{{schoolLogo}}" style="max-height: 35px; max-width: 100%; object-fit: contain; margin-bottom: 2px;" />
           {{else}}
             <h3 style="margin: 0; font-size: 13px; font-weight: 700; text-transform: uppercase;">EDDVA Academy</h3>
           {{/if}}
           <p style="margin: 0; font-size: 8px; font-weight: 500; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.5px;">Student Identity Card</p>
        </div>

        <!-- Photo -->
        <div style="text-align: center; margin-top: 15px;">
          {{#if profileImage}}
            <img src="{{profileImage}}" style="width: 70px; height: 70px; border-radius: 50%; object-fit: cover; border: 3px solid #3b82f6; margin: 0 auto; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />
          {{else}}
            <div style="width: 70px; height: 70px; background: #f8fafc; border-radius: 50%; border: 2px dashed #94a3b8; margin: 0 auto; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #64748b; text-align: center; line-height: 1.3; font-weight: 500;">
              Affix<br>Student<br>Photo
            </div>
          {{/if}}
        </div>

        <!-- Details -->
        <div style="padding: 10px; text-align: center;">
          <h2 style="margin: 0 0 8px 0; font-size: 14px; color: #0f172a; font-weight: 800;">{{firstName}} {{lastName}}</h2>
          <div style="font-size: 10px; color: #334155; text-align: left; margin-left: 10px; line-height: 1.6;">
            <p style="margin: 0;"><strong>Roll No:</strong> {{rollNo}}</p>
            <p style="margin: 0;"><strong>Section:</strong> {{section}}</p>
            <p style="margin: 0;"><strong>Blood Grp:</strong> <span style="color: #ef4444; font-weight: 700;">{{bloodGroup}}</span></p>
          </div>
        </div>

        <!-- Footer -->
        <div style="position: absolute; bottom: 0; width: 100%; background: #1e3a8a; text-align: center; padding: 6px 0;">
           <p style="margin: 0; font-size: 8px; color: #ffffff; font-weight: 600;">Academic Year: 2026-27</p>
        </div>
      </div>

      <!-- BACK SIDE -->
      <div style="width: 54mm; height: 86mm; border: 1px solid #cbd5e1; border-radius: 8px; box-sizing: border-box; background: #ffffff; padding: 15px 12px; position: relative; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
        
        <div style="font-size: 10px; color: #334155; line-height: 1.8;">
          <p style="margin: 0 0 6px 0;"><strong>D.O.B:</strong> {{dob}}</p>
          <p style="margin: 0 0 6px 0;"><strong>Parent/Guardian:</strong><br><span style="color: #0f172a; font-weight: 600;">{{parentName}}</span></p>
          <p style="margin: 0 0 6px 0;"><strong>Emergency Contact:</strong><br><span style="color: #0f172a; font-weight: 600;">{{parentPhone}}</span></p>
        </div>

        <div style="margin-top: 15px; text-align: center;">
          <p style="margin: 0 0 6px 0; font-size: 9px; color: #64748b; font-weight: 600;">Scan to Verify</p>
          <img src="{{qrCode}}" alt="QR" style="width: 60px; height: 60px; margin: 0 auto; display: block; border-radius: 4px;" />
        </div>

        <div style="position: absolute; bottom: 15px; width: 100%; left: 0; text-align: center;">
          <p style="margin: 0; font-size: 8px; color: #94a3b8; padding: 0 10px; line-height: 1.4;">If found, please return to:<br><strong>School Administration Office</strong></p>
        </div>
      </div>

    </div>
  `;

  await repo.query("UPDATE school_document_templates SET html_content = $1, dimensions = $2 WHERE type = 'ID_CARD_STUDENT'", [idCardHtml, JSON.stringify({ width: 130, height: 95 })]);
  console.log('ID Card template updated!');
  
  await app.close();
}
bootstrap();
