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

  private async logActivity(action: string, entity: any, event: any, details: any) {
    const tableName = event.metadata.tableName;
    // Skip logging the activity logs table itself or session/token tables
    if (['activity_logs', 'sessions', 'refresh_tokens'].includes(tableName)) return;

    const instituteId = entity.institute_id || entity.instituteId || entity.tenantId || 'SYSTEM';
    // If we have a user_id on the entity (e.g. they created it), log it. Otherwise SYSTEM.
    const userId = entity.created_by || entity.userId || entity.user_id || 'SYSTEM';

    await this.activityLogService.log(
      instituteId,
      userId,
      `${action}_${tableName.toUpperCase()}`,
      { entityId: entity.id, ...details }
    );
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
