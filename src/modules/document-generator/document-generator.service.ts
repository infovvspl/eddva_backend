import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as Handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';

import { SchoolDocumentTemplate, DocumentTemplateType } from '../school/entities/school-document-template.entity';
import { SchoolDocumentGenerationHistory, DocumentGenerationTarget } from '../school/entities/school-document-generation-history.entity';
import { IdCardRecord, IdCardTargetType, IdCardStatus } from '../school/entities/id-card-record.entity';
import { SchoolStudent } from '../school/entities/school-student.entity';
import { SchoolUser } from '../school/entities/school-user.entity';
import { SchoolInstitute } from '../school/entities/school-institute.entity';
import { SchoolSection } from '../school/entities/school-class.entity';
import { TeacherProfile } from '../../database/entities/teacher.entity';
import { CreateDocumentTemplateDto, GenerateIdCardDto, GenerateAdmitCardDto } from './dto/document-generator.dto';

@Injectable()
export class DocumentGeneratorService {
  private publicUrl: string;

  constructor(
    @InjectRepository(SchoolDocumentTemplate, 'school')
    private readonly templateRepo: Repository<SchoolDocumentTemplate>,
    @InjectRepository(SchoolDocumentGenerationHistory, 'school')
    private readonly historyRepo: Repository<SchoolDocumentGenerationHistory>,
    @InjectRepository(IdCardRecord, 'school')
    private readonly idCardRecordRepo: Repository<IdCardRecord>,
    @InjectRepository(SchoolStudent, 'school')
    private readonly schoolStudentRepo: Repository<SchoolStudent>,
    @InjectRepository(SchoolUser, 'school')
    private readonly userRepo: Repository<SchoolUser>,
    @InjectRepository(TeacherProfile, 'coaching')
    private readonly teacherRepo: Repository<TeacherProfile>,
    private readonly configService: ConfigService,
  ) {
    // Assuming frontend URL or API URL for verification
    this.publicUrl = this.configService.get<string>('app.frontendUrl') || 'http://localhost:5173';
  }

  async createTemplate(dto: CreateDocumentTemplateDto): Promise<SchoolDocumentTemplate> {
    const template = this.templateRepo.create(dto);
    return this.templateRepo.save(template);
  }

  async getTemplatesByType(type: DocumentTemplateType): Promise<SchoolDocumentTemplate[]> {
    return this.templateRepo.find({ where: { type, isActive: true } });
  }

  async generateIdCard(dto: GenerateIdCardDto, instituteId: string, adminId: string): Promise<Buffer> {
    try {
      const template = await this.templateRepo.findOne({ where: { id: dto.templateId } });
      if (!template) throw new NotFoundException('Template not found');

      let templateDataList = [];
      const generatedRecords: IdCardRecord[] = [];

      // Support both new bulk fields and legacy single field
      const targetStudentIds = dto.studentIds?.length ? dto.studentIds : (dto.studentId ? [dto.studentId] : []);
      const targetStaffIds = dto.staffIds || [];

      if (dto.targetType === DocumentGenerationTarget.CLASS || targetStudentIds.length > 0) {
        // ── Generate for Students ──
        const qb = this.schoolStudentRepo.createQueryBuilder('s');
        qb.where('s.instituteId = :instituteId', { instituteId });
        console.log('[ID_CARD_DEBUG] instituteId:', instituteId, 'targetStudentIds:', targetStudentIds, 'sectionId:', dto.sectionId, 'classId:', dto.classId);

        // Fetch institute details for logo
      const institute = await this.templateRepo.manager.findOne(SchoolInstitute, { where: { id: instituteId } });
      const schoolLogo = institute?.logo || '';

      if (targetStudentIds.length > 0) {
          qb.andWhere('s.userId IN (:...ids)', { ids: targetStudentIds });
        } else if (dto.sectionId) {
          qb.andWhere('s.sectionId = :sectionId', { sectionId: dto.sectionId });
        } else if (dto.classId) {
          qb.innerJoin('sections', 'sec', 'sec.id = s.section_id')
            .andWhere('sec.class_id = :classId', { classId: dto.classId });
        }

        const students = await qb.getMany();
        console.log('[ID_CARD_DEBUG] Found students:', students.length);
        
        for (const student of students) {
          const user = await this.userRepo.findOne({ where: { id: student.userId } });
          if (!user) {
            console.log('[ID_CARD_DEBUG] Missing user for student:', student.userId);
            continue;
          }

          const recordId = uuidv4();
          const qrCodeHash = uuidv4(); // Unique hash for public verification link
          const verificationUrl = `${this.publicUrl}/verify/id-card/${qrCodeHash}`;
          const qrCodeDataUri = await QRCode.toDataURL(verificationUrl, { errorCorrectionLevel: 'H' });

          let sectionName = 'N/A';
          if (student.sectionId) {
            const section = await this.templateRepo.manager.findOne(SchoolSection, { where: { id: student.sectionId } });
            if (section) sectionName = section.name;
          }

          templateDataList.push({
            firstName: user.name?.split(' ')[0] || '',
            lastName: user.name?.split(' ').slice(1).join(' ') || '',
            rollNo: student.rollNo || student.enrollmentNo || 'N/A',
            section: sectionName,
            dob: student.dob ? new Date(student.dob).toLocaleDateString() : 'N/A',
            bloodGroup: student.bloodGroup || 'N/A',
            parentName: student.fatherName || student.motherName || 'N/A',
            parentPhone: student.parentPhone || 'N/A',
            profileImage: user.profileImage || '',
            schoolLogo,
            qrCode: qrCodeDataUri,
          });

          const record = this.idCardRecordRepo.create({
            id: recordId,
            targetType: IdCardTargetType.STUDENT,
            targetId: student.userId,
            documentType: template.type,
            qrCodeHash,
          });
          generatedRecords.push(record);
        }
      } else if (targetStaffIds.length > 0) {
        // ── Generate for Staff ──
        const staffList = await this.teacherRepo.find({ where: { userId: In(targetStaffIds) } });
        
        for (const staff of staffList) {
          const user = await this.userRepo.findOne({ where: { id: staff.userId } });
          if (!user) continue;

          const recordId = uuidv4();
          const qrCodeHash = uuidv4();
          const verificationUrl = `${this.publicUrl}/verify/id-card/${qrCodeHash}`;
          const qrCodeDataUri = await QRCode.toDataURL(verificationUrl, { errorCorrectionLevel: 'H' });

          templateDataList.push({
            firstName: user.name?.split(' ')[0] || '',
            lastName: user.name?.split(' ').slice(1).join(' ') || '',
            employeeId: staff.id.substring(0,8), // Replace with actual Employee ID if exists
            department: 'Academic', // Replace with real dept
            qrCode: qrCodeDataUri,
          });

          const record = this.idCardRecordRepo.create({
            id: recordId,
            targetType: IdCardTargetType.STAFF,
            targetId: staff.userId,
            documentType: template.type,
            qrCodeHash,
          });
          generatedRecords.push(record);
        }
      }

      console.log('[ID_CARD_DEBUG] templateDataList length:', templateDataList.length);
      if (templateDataList.length === 0) {
        throw new BadRequestException('No targets found for ID card generation.');
      }

      // Save all records first
      await this.idCardRecordRepo.save(generatedRecords);

      // Compile and Render PDF
      const htmlContent = this.compileTemplate(template.htmlContent, templateDataList);
      const pdfBuffer = await this.renderPdf(htmlContent, template.dimensions);

      const history = this.historyRepo.create({
        documentType: template.type,
        generatedFor: dto.targetType,
        targetId: dto.classId || (dto.studentIds && dto.studentIds.length ? '00000000-0000-0000-0000-000000000000' : '11111111-1111-1111-1111-111111111111'),
        generatedBy: adminId,
        fileUrl: '', // Will stream directly to frontend
      });
      await this.historyRepo.save(history);

      return pdfBuffer;
    } catch (err: any) {
      console.error('ID Card Generation Error:', err);
      throw new BadRequestException('ID Card Generation failed: ' + err.message);
    }
  }

  async generateAdmitCard(dto: GenerateAdmitCardDto, instituteId: string, adminId: string): Promise<Buffer> {
    try {
      const template = await this.templateRepo.findOne({ where: { id: dto.templateId } });
      if (!template) throw new NotFoundException('Template not found');

      const mockData = [
        { firstName: 'John', lastName: 'Doe', examName: 'Mid-Term 2026', center: 'Hall A' }
      ];

      const htmlContent = this.compileTemplate(template.htmlContent, mockData);
      const pdfBuffer = await this.renderPdf(htmlContent, template.dimensions);

      const fileUrl = 'https://mock-s3-bucket.com/generated-admit-cards.pdf';

      const history = this.historyRepo.create({
        documentType: template.type,
        generatedFor: DocumentGenerationTarget.CLASS,
        targetId: dto.classId || '00000000-0000-0000-0000-000000000000',
        generatedBy: adminId,
        fileUrl: '', // Stream to frontend
      });
      await this.historyRepo.save(history);

      return pdfBuffer;
    } catch (err: any) {
      console.error('Admit Card Generation Error:', err);
      throw new BadRequestException('Admit Card Generation failed: ' + err.message);
    }
  }

  async getIdCardHistory() {
    return this.idCardRecordRepo.find({ order: { issuedAt: 'DESC' } });
  }

  async updateIdCardStatus(id: string, status: IdCardStatus) {
    const record = await this.idCardRecordRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('ID Card Record not found');
    
    record.status = status;
    if (status === IdCardStatus.LOST || status === IdCardStatus.INACTIVE) {
       // logic can go here
    }
    return this.idCardRecordRepo.save(record);
  }

  async verifyIdCard(qrCodeHash: string) {
    const record = await this.idCardRecordRepo.findOne({ where: { qrCodeHash } });
    if (!record) throw new NotFoundException('Invalid or unknown QR Code');

    let name = 'Unknown';
    let details = {};

    if (record.targetType === IdCardTargetType.STUDENT) {
       const student = await this.schoolStudentRepo.findOne({ where: { userId: record.targetId } });
       const user = await this.userRepo.findOne({ where: { id: record.targetId } });
       name = user?.name || 'Unknown';
       details = { rollNo: student?.rollNo || student?.enrollmentNo, classId: student?.sectionId }; // simplified
    } else {
       const staff = await this.teacherRepo.findOne({ where: { userId: record.targetId } });
       const user = await this.userRepo.findOne({ where: { id: record.targetId } });
       name = user?.name || 'Unknown';
       details = { employeeId: staff?.id.substring(0,8) };
    }

    return {
      status: record.status,
      issuedAt: record.issuedAt,
      name,
      targetType: record.targetType,
      details,
    };
  }

  private compileTemplate(templateHtml: string, dataList: any[]): string {
    const template = Handlebars.compile(templateHtml);
    let combinedHtml = `<div style="display: flex; flex-wrap: wrap; gap: 10px;">`;
    for (const data of dataList) {
      combinedHtml += `<div>${template(data)}</div>`;
    }
    combinedHtml += `</div>`;
    return combinedHtml;
  }

  private async renderPdf(html: string, dimensions?: { width: number; height: number }): Promise<Buffer> {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    
    const pdfOptions: any = { printBackground: true };
    if (dimensions && dimensions.width && dimensions.height) {
        pdfOptions.width = `${dimensions.width}mm`;
        pdfOptions.height = `${dimensions.height}mm`;
    } else {
        pdfOptions.format = 'A4';
    }

    const pdfBuffer = await page.pdf(pdfOptions);
    await browser.close();
    return Buffer.from(pdfBuffer);
  }
}
