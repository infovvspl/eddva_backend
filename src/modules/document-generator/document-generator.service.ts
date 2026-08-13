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
import { CreateDocumentTemplateDto, UpdateDocumentTemplateDto, GenerateIdCardDto, GenerateAdmitCardDto } from './dto/document-generator.dto';

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

  async updateTemplate(id: string, dto: UpdateDocumentTemplateDto): Promise<SchoolDocumentTemplate> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    
    Object.assign(template, dto);
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

      console.log('--- GENERATE ID CARD CALLED ---');
      console.log('DTO:', dto);
      console.log('targetStudentIds:', targetStudentIds);

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
          let className = 'N/A';
          if (student.sectionId) {
            const section = await this.templateRepo.manager.findOne(SchoolSection, { where: { id: student.sectionId } });
            if (section) {
              sectionName = section.name;
              // Try to get class name from section
              try {
                const classResult = await this.templateRepo.manager.query(
                  `SELECT c.name FROM classes c JOIN sections s ON s.class_id = c.id WHERE s.id = $1 LIMIT 1`,
                  [student.sectionId]
                );
                if (classResult?.[0]?.name) className = classResult[0].name;
              } catch (e) { /* ignore */ }
            }
          }

          const fullName = user.name || '';
          const schoolName = institute?.name || '';
          const schoolAddress = [institute?.address, institute?.city, institute?.state, institute?.pinCode].filter(Boolean).join(', ') || '';

          templateDataList.push({
            firstName: fullName.split(' ')[0] || '',
            lastName: fullName.split(' ').slice(1).join(' ') || '',
            fullName,
            rollNo: student.rollNo || student.enrollmentNo || 'N/A',
            section: sectionName,
            className,
            dob: student.dob ? new Date(student.dob).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A',
            bloodGroup: student.bloodGroup || 'N/A',
            fatherName: student.fatherName || 'N/A',
            motherName: student.motherName || 'N/A',
            parentName: student.fatherName || student.motherName || 'N/A',
            parentPhone: student.parentPhone || 'N/A',
            phone: student.parentPhone || 'N/A',
            address: schoolAddress,
            profileImage: user.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'Student')}&background=f1f5f9&color=64748b&size=256`,
            schoolLogo,
            schoolName,
            schoolAddress,
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
      } else if (dto.targetType === DocumentGenerationTarget.STAFF || dto.targetType === DocumentGenerationTarget.STAFF_INDIVIDUAL || targetStaffIds.length > 0) {
        // ── Generate for Staff ──
        const qb = this.userRepo.createQueryBuilder('u')
          .where('u.instituteId = :instituteId', { instituteId })
          .andWhere('u.role LIKE :role', { role: '%TEACHER%' }); // Only teachers for now

        if (targetStaffIds.length > 0) {
          qb.andWhere('u.id IN (:...ids)', { ids: targetStaffIds });
        }

        const staffList = await qb.getMany();

        // Fetch institute details for logo
        const institute = await this.templateRepo.manager.findOne(SchoolInstitute, { where: { id: instituteId } });
        const schoolLogo = institute?.logo || '';
        const schoolName = institute?.name || '';
        const schoolAddress = [institute?.address, institute?.city, institute?.state, institute?.pinCode].filter(Boolean).join(', ') || '';

        for (const user of staffList) {
          const recordId = uuidv4();
          const qrCodeHash = uuidv4();
          const verificationUrl = `${this.publicUrl}/verify/id-card/${qrCodeHash}`;
          const qrCodeDataUri = await QRCode.toDataURL(verificationUrl, { errorCorrectionLevel: 'H' });

          templateDataList.push({
            fullName: user.name || '',
            firstName: user.name?.split(' ')[0] || '',
            lastName: user.name?.split(' ').slice(1).join(' ') || '',
            employeeId: user.id.substring(0,8), // Fallback to user ID
            department: 'Academic', // Replace with real dept
            phone: user.phone || 'N/A',
            profileImage: user.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'Teacher')}&background=0f172a&color=fff&size=256`,
            schoolLogo,
            schoolName,
            schoolAddress,
            qrCode: qrCodeDataUri,
          });

          const record = this.idCardRecordRepo.create({
            id: recordId,
            targetType: IdCardTargetType.STAFF,
            targetId: user.id,
            documentType: template.type,
            qrCodeHash,
          });
          generatedRecords.push(record);
        }
      }

      console.log('[ID_CARD_DEBUG] templateDataList length:', templateDataList.length);
      if (templateDataList.length === 0) {
        throw new BadRequestException('No students were found in the selected class/section. Please ensure students are enrolled before generating ID cards.');
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

      let studentsQuery = this.schoolStudentRepo.createQueryBuilder('student')
        .where('student.instituteId = :instituteId', { instituteId });

      if (dto.studentIds && dto.studentIds.length > 0) {
        studentsQuery = studentsQuery.andWhere('student.userId IN (:...studentIds)', { studentIds: dto.studentIds });
      } else if (dto.classId) {
        studentsQuery = studentsQuery.innerJoin('sections', 'sec', 'sec.id = student.section_id')
                                     .andWhere('sec.class_id = :classId', { classId: dto.classId });
        if (dto.sectionId) {
          studentsQuery = studentsQuery.andWhere('student.sectionId = :sectionId', { sectionId: dto.sectionId });
        }
      } else {
        throw new BadRequestException('Must provide classId or studentIds');
      }

      const students = await studentsQuery.getMany();
      if (!students.length) throw new NotFoundException('No students found for given criteria');

      const institute = await this.templateRepo.manager.findOne(SchoolInstitute, { where: { id: instituteId } });
      const schoolName = institute?.name || 'Your School Name';
      const schoolLogo = institute?.logo || '';
      const schoolAddress = institute?.address || 'School Address';

      const dummyTimetable = [
        { subject: 'Mathematics', date: '10 Oct 2026', time: '10:00 AM - 01:00 PM' },
        { subject: 'Science', date: '12 Oct 2026', time: '10:00 AM - 01:00 PM' },
        { subject: 'English', date: '14 Oct 2026', time: '10:00 AM - 01:00 PM' },
      ];

      const dataList = [];
      for (const student of students) {
        const user = await this.userRepo.findOne({ where: { id: student.userId } });
        if (!user) continue;

        let sectionName = student.sectionId || 'A';
        let className = 'N/A';
        if (student.sectionId) {
          const section = await this.templateRepo.manager.findOne(SchoolSection, { where: { id: student.sectionId } });
          if (section) {
            sectionName = section.name;
            try {
              const classResult = await this.templateRepo.manager.query(
                `SELECT c.name FROM classes c JOIN sections s ON s.class_id = c.id WHERE s.id = $1 LIMIT 1`,
                [student.sectionId]
              );
              if (classResult?.[0]?.name) className = classResult[0].name;
            } catch (e) { /* ignore */ }
          }
        }

        dataList.push({
          fullName: user.name || '',
          firstName: user.name?.split(' ')[0] || '',
          lastName: user.name?.split(' ').slice(1).join(' ') || '',
          rollNo: student.rollNo || student.enrollmentNo || '',
          className,
          section: sectionName,
          fatherName: student.fatherName || 'N/A',
          dob: student.dob ? new Date(student.dob).toLocaleDateString() : 'N/A',
          profileImage: user.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'Student')}&background=f1f5f9&color=64748b&size=256`,
          schoolName,
          schoolLogo,
          schoolAddress,
          examName: dto.examId || 'EXAMINATION',
          center: 'Main Campus',
          qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=RollNo:${student.rollNo || student.enrollmentNo}`,
          timetable: dummyTimetable
        });
      }

      let htmlContent = template.htmlContent;
      if (htmlContent.includes('{{#each items}}') || htmlContent.includes('{{#each this.items}}') || htmlContent.includes('{{#each this}}')) {
        htmlContent = this.compileTemplate(htmlContent, dataList);
      } else {
        // Fallback: render each item individually and concatenate with page break
        const compiled = Handlebars.compile(htmlContent);
        htmlContent = dataList.map(data => compiled(data)).join('\n<div style="page-break-after: always;"></div>\n');
      }

      const pdfBuffer = await this.renderPdf(htmlContent, template.dimensions);

      // (We are streaming directly to frontend; real app might upload to S3 first)
      const fileUrl = 'downloaded_directly';

      const history = this.historyRepo.create({
        documentType: template.type,
        generatedFor: dto.studentIds?.length ? DocumentGenerationTarget.INDIVIDUAL : DocumentGenerationTarget.CLASS,
        targetId: dto.classId || '00000000-0000-0000-0000-000000000000',
        generatedBy: adminId,
        fileUrl,
      });
      await this.historyRepo.save(history);

      return pdfBuffer;
    } catch (err: any) {
      console.error('Admit Card Generation Error:', err);
      throw new BadRequestException('Admit Card Generation failed: ' + err.message);
    }
  }

  async generateCertificate(dto: any, instituteId: string, adminId: string): Promise<Buffer> {
    try {
      const template = await this.templateRepo.findOne({ where: { id: dto.templateId } });
      if (!template) throw new NotFoundException('Template not found');

      let studentsQuery = this.schoolStudentRepo.createQueryBuilder('student')
        .where('student.instituteId = :instituteId', { instituteId });

      if (dto.studentIds && dto.studentIds.length > 0) {
        studentsQuery = studentsQuery.andWhere('student.userId IN (:...studentIds)', { studentIds: dto.studentIds });
      } else if (dto.classId) {
        studentsQuery = studentsQuery.innerJoin('sections', 'sec', 'sec.id = student.section_id')
                                     .andWhere('sec.class_id = :classId', { classId: dto.classId });
        if (dto.sectionId) {
          studentsQuery = studentsQuery.andWhere('student.sectionId = :sectionId', { sectionId: dto.sectionId });
        }
      } else {
        throw new BadRequestException('Must provide classId or studentIds');
      }

      const students = await studentsQuery.getMany();
      if (!students.length) throw new NotFoundException('No students found for given criteria');

      const institute = await this.templateRepo.manager.findOne(SchoolInstitute, { where: { id: instituteId } });
      const schoolName = institute?.name || 'Your School Name';
      const schoolLogo = institute?.logo || '';
      const schoolAddress = institute?.address || 'School Address';

      const dataList = [];
      for (const student of students) {
        const user = await this.userRepo.findOne({ where: { id: student.userId } });
        if (!user) continue;

        let sectionName = student.sectionId || 'A';
        let className = 'N/A';
        if (student.sectionId) {
          const section = await this.templateRepo.manager.findOne(SchoolSection, { where: { id: student.sectionId } });
          if (section) {
            sectionName = section.name;
            try {
              const classResult = await this.templateRepo.manager.query(
                `SELECT c.name FROM classes c JOIN sections s ON s.class_id = c.id WHERE s.id = $1 LIMIT 1`,
                [student.sectionId]
              );
              if (classResult?.[0]?.name) className = classResult[0].name;
            } catch (e) { /* ignore */ }
          }
        }

        dataList.push({
          fullName: user.name || '',
          firstName: user.name?.split(' ')[0] || '',
          lastName: user.name?.split(' ').slice(1).join(' ') || '',
          rollNo: student.rollNo || student.enrollmentNo || '',
          className,
          section: sectionName,
          fatherName: student.fatherName || 'N/A',
          parentName: student.fatherName || student.motherName || 'N/A',
          dob: student.dob ? new Date(student.dob).toLocaleDateString() : 'N/A',
          profileImage: user.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'Student')}&background=f1f5f9&color=64748b&size=256`,
          schoolName,
          schoolLogo,
          schoolAddress,
          issueDate: new Date().toLocaleDateString(),
          reasonForTransfer: student.reasonForTransfer || 'Graduation / Passed out',
        });
      }

      let htmlContent = template.htmlContent;
      if (htmlContent.includes('{{#each items}}') || htmlContent.includes('{{#each this.items}}') || htmlContent.includes('{{#each this}}')) {
        htmlContent = this.compileTemplate(htmlContent, dataList);
      } else {
        const compiled = Handlebars.compile(htmlContent);
        htmlContent = dataList.map(data => compiled(data)).join('\n<div style="page-break-after: always;"></div>\n');
      }

      const dimensions = template.dimensions || { width: 794, height: 1123, margin: 0 };
      const pdfBuffer = await this.renderPdf(htmlContent, dimensions as any);

      const history = this.historyRepo.create({
        documentType: template.type,
        generatedFor: dto.studentIds?.length ? DocumentGenerationTarget.INDIVIDUAL : DocumentGenerationTarget.CLASS,
        targetId: dto.classId || '00000000-0000-0000-0000-000000000000',
        generatedBy: adminId,
        fileUrl: 'downloaded_directly',
      });
      await this.historyRepo.save(history);

      return pdfBuffer;
    } catch (err: any) {
      console.error('Certificate Generation Error:', err);
      throw new BadRequestException('Certificate Generation failed: ' + err.message);
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
    
    // If the template itself handles looping through multiple items
    if (templateHtml.includes('{{#each items}}') || templateHtml.includes('{{#each this.items}}')) {
      return template({ items: dataList });
    }
    
    if (templateHtml.includes('{{#each this}}')) {
      return template(dataList);
    }

    // Fallback for older templates that expect to be rendered per-item
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
    await page.setContent(html, { waitUntil: 'load' });
    const pdfOptions: any = { 
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    };
    if (dimensions && dimensions.width && dimensions.height) {
        // If dimensions > 300, it's likely pixels (e.g. A4 794x1123), otherwise assume mm (e.g. ID Card 54x86)
        const unitWidth = dimensions.width > 300 ? 'px' : 'mm';
        const unitHeight = dimensions.height > 300 ? 'px' : 'mm';
        pdfOptions.width = `${dimensions.width}${unitWidth}`;
        pdfOptions.height = `${dimensions.height}${unitHeight}`;
    } else {
        pdfOptions.format = 'A4';
    }

    const pdfBuffer = await page.pdf(pdfOptions);
    await browser.close();
    return Buffer.from(pdfBuffer);
  }
}
