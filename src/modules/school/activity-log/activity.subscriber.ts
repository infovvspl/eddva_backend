import {
  EventSubscriber,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
  RemoveEvent,
} from 'typeorm';
import { SchoolActivityLogService } from './school-activity-log.service';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@EventSubscriber()
@Injectable()
export class ActivitySubscriber implements EntitySubscriberInterface {
  constructor(
    @InjectDataSource('school') private dataSource: DataSource,
    private readonly activityLogService: SchoolActivityLogService,
  ) {
    dataSource.subscribers.push(this);
  }

  // We only log operations if we can resolve the instituteId and userId.
  // In a real production system, user context is usually injected via AsyncLocalStorage.
  // For this subscriber, we'll try to extract instituteId from the entity itself if present.

  private static readonly UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private asUuid(value: unknown): string | null {
    return typeof value === 'string' && ActivitySubscriber.UUID_RE.test(value) ? value : null;
  }

  private async logActivity(action: string, entity: any, event: any, details: any) {
    const tableName = event.metadata.tableName;
    // Skip logging the activity logs table itself or session/token tables
    if (['activity_logs', 'sessions', 'refresh_tokens'].includes(tableName)) return;

    // institute_id / user_id are UUID columns — only log with real UUIDs.
    const instituteId = this.asUuid(entity.institute_id ?? entity.instituteId ?? entity.tenantId);
    const userId = this.asUuid(
      entity.created_by ?? entity.userId ?? entity.user_id ?? entity.studentId ?? entity.student_id ?? entity.teacher_id,
    );

    // Without a valid institute we can't attribute the activity — skip silently.
    if (!instituteId) return;

    // Activity logging must NEVER break the operation that triggered it.
    try {
      await this.activityLogService.log(
        instituteId,
        userId,
        `${action}_${tableName.toUpperCase()}`,
        { entityId: entity.id, ...details },
      );
    } catch {
      // best-effort: swallow logging failures
    }
  }

  async afterInsert(event: InsertEvent<any>) {
    if (!event.entity) return;
    await this.logActivity('CREATE', event.entity, event, { newValues: event.entity });
  }

  async afterUpdate(event: UpdateEvent<any>) {
    if (!event.entity) return;
    const oldValues = event.databaseEntity;
    const newValues = event.entity;
    await this.logActivity('UPDATE', event.entity, event, { oldValues, newValues });
  }

  async afterRemove(event: RemoveEvent<any>) {
    if (!event.databaseEntity) return;
    await this.logActivity('DELETE', event.databaseEntity, event, { oldValues: event.databaseEntity });
  }
}
