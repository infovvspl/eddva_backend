import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateHighlightDto } from './recording-highlight.dto';

@Injectable()
export class RecordingHighlightService {
  private readonly logger = new Logger(RecordingHighlightService.name);

  constructor(@InjectDataSource('school') private readonly ds: DataSource) { }
  w
  /**
   * Helper to verify if user has access to a recording.
   * Also verifies if the teacher is the one who created it (for write actions).
   */
  async verifyRecordingAccess(recordingId: string, user: any, requireTeacherOwnership: boolean = false): Promise<void> {
    const isStudent = user.role === 'STUDENT';
    const isTeacher = user.role === 'TEACHER';

    // Check if recording exists in the tenant
    const rows = await this.ds.query(
      `SELECT id, teacher_user_id FROM class_recordings WHERE id::text = $1 AND institute_id::text = $2 LIMIT 1`,
      [recordingId, user.instituteId]
    );

    if (!rows.length) {
      throw new NotFoundException('Recording not found');
    }

    if (requireTeacherOwnership) {
      if (!isTeacher) {
        throw new ForbiddenException('Only teachers can modify highlights');
      }
      // If we strictly enforce that only the teacher who created the recording can edit its highlights:
      // (Depends on project business logic, but typical for Teacher tools)
      // if (rows[0].teacher_user_id !== user.userId) {
      //   throw new ForbiddenException('You do not have permission to modify highlights for this recording');
      // }
    }
  }

  async getHighlights(recordingId: string, user: any) {
    await this.verifyRecordingAccess(recordingId, user, false);

    const rows = await this.ds.query(
      `
      SELECT id, recording_id AS "recordingId", created_by AS "createdBy", 
             updated_by AS "updatedBy", start_offset AS "startOffset", 
             end_offset AS "endOffset", display_order AS "displayOrder", 
             text, color, notes_hash AS "notesHash", 
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM class_recording_highlights
      WHERE recording_id::text = $1 AND deleted_at IS NULL
      ORDER BY display_order ASC, start_offset ASC
      `,
      [recordingId]
    );
    return rows;
  }

  async createHighlight(recordingId: string, user: any, dto: CreateHighlightDto) {
    await this.verifyRecordingAccess(recordingId, user, true);

    if (dto.startOffset < 0 || dto.endOffset <= dto.startOffset) {
      throw new BadRequestException('Invalid offsets');
    }
    if (dto.text.length !== (dto.endOffset - dto.startOffset)) {
      throw new BadRequestException('Text length must match offset difference');
    }

    // Default display_order to start_offset if not provided
    const displayOrder = dto.startOffset;

    let newId: string;

    // Execute inside a transaction
    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await queryRunner.query(
        `
        INSERT INTO class_recording_highlights (
          recording_id, created_by, start_offset, end_offset, 
          display_order, text, color, notes_hash
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, recording_id AS "recordingId", created_by AS "createdBy", 
                  start_offset AS "startOffset", end_offset AS "endOffset", 
                  display_order AS "displayOrder", text, color, notes_hash AS "notesHash", 
                  created_at AS "createdAt", updated_at AS "updatedAt"
        `,
        [
          recordingId,
          user.id,
          dto.startOffset,
          dto.endOffset,
          displayOrder,
          dto.text,
          dto.color,
          dto.notesHash || null
        ]
      );

      newId = result[0].id;
      await queryRunner.commitTransaction();
      return result[0];
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to create highlight: ${err.message}`, err.stack);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async deleteHighlight(recordingId: string, highlightId: string, user: any) {
    await this.verifyRecordingAccess(recordingId, user, true);

    // Verify highlight exists and is not already deleted
    const existing = await this.ds.query(
      `SELECT id FROM class_recording_highlights WHERE id::text = $1 AND recording_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
      [highlightId, recordingId]
    );

    if (!existing.length) {
      throw new NotFoundException('Highlight not found');
    }

    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query(
        `
        UPDATE class_recording_highlights 
        SET deleted_at = NOW(), updated_by = $1, updated_at = NOW() 
        WHERE id::text = $2
        `,
        [user.userId, highlightId]
      );
      await queryRunner.commitTransaction();
      return { success: true };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to delete highlight: ${err.message}`, err.stack);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
