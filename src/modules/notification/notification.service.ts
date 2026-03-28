import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { In, LessThan, Repository } from 'typeorm';
import * as Twilio from 'twilio';

import {
  Notification,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '../../database/entities/analytics.entity';
import { Student } from '../../database/entities/student.entity';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';

import {
  ManualNotificationChannel,
  NotificationListQueryDto,
  SendNotificationDto,
} from './dto/notification.dto';

type SendPayload = {
  userId: string;
  tenantId: string;
  title: string;
  body: string;
  channels: ('push' | 'sms' | 'whatsapp' | 'in_app')[];
  refType?: string;
  refId?: string;
};

type SendChannel = SendPayload['channels'][number];

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly configService: ConfigService,
  ) {}

  async getNotifications(userId: string, tenantId: string, query: NotificationListQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.notificationRepo
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .andWhere('notification.tenantId = :tenantId', { tenantId })
      .andWhere('notification.deletedAt IS NULL');

    if (query.isRead !== undefined) {
      if (query.isRead) {
        qb.andWhere('notification.status = :readStatus', { readStatus: NotificationStatus.READ });
      } else {
        qb.andWhere('notification.status != :readStatus', { readStatus: NotificationStatus.READ });
      }
    }

    qb.orderBy('COALESCE(notification.sentAt, notification.createdAt)', 'DESC')
      .skip(skip)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return {
      data: data.map((notification) => this.serializeNotification(notification)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  async markAsRead(id: string, userId: string, tenantId: string) {
    const notification = await this.notificationRepo.findOne({
      where: { id, userId, tenantId },
    });
    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    if (notification.status !== NotificationStatus.READ) {
      notification.status = NotificationStatus.READ;
      notification.readAt = new Date();
      await this.notificationRepo.save(notification);
    }

    return this.serializeNotification(notification);
  }

  async markAllAsRead(userId: string, tenantId: string) {
    const now = new Date();
    await this.notificationRepo
      .createQueryBuilder()
      .update(Notification)
      .set({ status: NotificationStatus.READ, readAt: now })
      .where('user_id = :userId', { userId })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere('status != :readStatus', { readStatus: NotificationStatus.READ })
      .execute();

    return { message: 'All notifications marked as read' };
  }

  async getUnreadCount(userId: string, tenantId: string) {
    const count = await this.notificationRepo.count({
      where: {
        userId,
        tenantId,
        status: In([
          NotificationStatus.PENDING,
          NotificationStatus.SENT,
          NotificationStatus.FAILED,
        ]),
      },
    });

    return { count };
  }

  async send(payload: SendPayload): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: payload.userId, tenantId: payload.tenantId },
    });
    if (!user) {
      this.logger.warn(`Skipping notification for missing user ${payload.userId}`);
      return;
    }

    const channels: SendChannel[] = payload.channels.includes('in_app')
      ? payload.channels
      : [...payload.channels, 'in_app'];

    for (const channel of channels) {
      const notification = this.notificationRepo.create({
        userId: payload.userId,
        tenantId: payload.tenantId,
        title: payload.title,
        body: payload.body,
        type: this.resolveNotificationType(payload.refType),
        channel: this.mapChannel(channel),
        status: NotificationStatus.PENDING,
        sentAt: channel === 'in_app' ? new Date() : null,
        data: {
          refType: payload.refType,
          refId: payload.refId,
        },
      });

      await this.notificationRepo.save(notification);

      if (channel === 'in_app') {
        notification.status = NotificationStatus.SENT;
        await this.notificationRepo.save(notification);
        continue;
      }

      try {
        if (channel === 'push') {
          await this.sendFcmPush(user, payload.title, payload.body);
        } else if (channel === 'sms') {
          await this.sendSms(user, payload.body);
        } else if (channel === 'whatsapp') {
          await this.sendWhatsApp(user, payload.body);
        }

        notification.status = NotificationStatus.SENT;
        notification.sentAt = new Date();
      } catch (error) {
        notification.status = NotificationStatus.FAILED;
        notification.failureReason = error.message;
        this.logger.warn(`Notification send failed for user ${payload.userId} via ${channel}: ${error.message}`);
      }

      await this.notificationRepo.save(notification);
    }
  }

  async sendManualBlast(dto: SendNotificationDto) {
    const users = await this.userRepo.find({
      where: { id: In(dto.userIds) },
    });

    for (const user of users) {
      await this.send({
        userId: user.id,
        tenantId: user.tenantId,
        title: dto.title,
        body: dto.body,
        channels: [dto.type as ManualNotificationChannel],
        refType: dto.refType,
        refId: dto.refId,
      });
    }

    return { sent: users.length };
  }

  @Cron('0 7 * * *', { timeZone: 'Asia/Kolkata' })
  async sendMorningNudge() {
    const students = await this.getActiveStudents();
    for (const student of students) {
      await this.send({
        userId: student.userId,
        tenantId: student.tenantId,
        title: 'Good morning! 🌅',
        body: "Your study plan is ready. Let's go!",
        channels: ['push', 'in_app'],
        refType: 'daily_nudge',
      });
    }
  }

  @Cron('45 18 * * *', { timeZone: 'Asia/Kolkata' })
  async sendBattleReminder() {
    const students = await this.getActiveStudents();
    for (const student of students) {
      await this.send({
        userId: student.userId,
        tenantId: student.tenantId,
        title: 'Daily battle starts in 15 minutes ⚔️',
        body: 'Join the arena and protect your rank.',
        channels: ['push', 'in_app'],
        refType: 'battle_reminder',
      });
    }
  }

  @Cron('0 20 * * *', { timeZone: 'Asia/Kolkata' })
  async sendStreakDangerAlerts() {
    const today = new Date().toISOString().slice(0, 10);
    const students = await this.studentRepo.find({
      where: {
        currentStreak: LessThan(Number.MAX_SAFE_INTEGER),
        lastActiveDate: LessThan(today),
      },
      relations: ['user'],
    });

    for (const student of students) {
      if (!student.user || student.user.status !== UserStatus.ACTIVE || student.currentStreak <= 0) {
        continue;
      }

      await this.send({
        userId: student.userId,
        tenantId: student.tenantId,
        title: 'Streak danger',
        body: `⚠️ Study today to save your ${student.currentStreak}-day streak!`,
        channels: ['push', 'in_app'],
        refType: 'streak_danger',
      });
    }
  }

  @Cron('0 20 * * 0', { timeZone: 'Asia/Kolkata' })
  async sendWeeklyParentReports() {
    const parents = await this.userRepo.find({
      where: { role: UserRole.PARENT, status: UserStatus.ACTIVE },
    });

    for (const parent of parents) {
      const student = await this.studentRepo.findOne({
        where: { parentUserId: parent.id, tenantId: parent.tenantId },
        relations: ['user'],
      });
      if (!student?.user) continue;

      await this.send({
        userId: parent.id,
        tenantId: parent.tenantId,
        title: 'Weekly report ready',
        body: `📊 Weekly report for ${student.user.fullName} is ready`,
        channels: ['in_app', 'whatsapp'],
        refType: 'weekly_report',
        refId: student.id,
      });
    }
  }

  private async getActiveStudents() {
    return this.studentRepo.find({
      relations: ['user'],
      where: {
        user: {
          role: UserRole.STUDENT,
          status: UserStatus.ACTIVE,
        } as any,
      } as any,
    });
  }

  private serializeNotification(notification: Notification) {
    return {
      ...notification,
      isRead: notification.status === NotificationStatus.READ,
      refType: notification.data?.refType ?? null,
      refId: notification.data?.refId ?? null,
    };
  }

  private resolveNotificationType(refType?: string) {
    if (!refType) {
      return NotificationType.GENERAL;
    }

    const normalized = refType.toUpperCase();
    return NotificationType[normalized] ?? NotificationType.GENERAL;
  }

  private mapChannel(channel: SendChannel) {
    switch (channel) {
      case 'push':
        return NotificationChannel.PUSH;
      case 'sms':
        return NotificationChannel.SMS;
      case 'whatsapp':
        return NotificationChannel.WHATSAPP;
      case 'in_app':
      default:
        return NotificationChannel.IN_APP;
    }
  }

  private async sendFcmPush(user: User, title: string, body: string) {
    const serverKey = this.configService.get<string>('FCM_SERVER_KEY');
    if (!serverKey) {
      this.logger.warn('FCM_SERVER_KEY is not configured. Skipping push notification.');
      return;
    }

    if (!user.fcmToken) {
      this.logger.warn(`User ${user.id} has no FCM token. Skipping push notification.`);
      return;
    }

    let admin: any;
    try {
      admin = require('firebase-admin');
    } catch {
      this.logger.warn('firebase-admin is not installed. Skipping push notification.');
      return;
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.configService.get<string>('FCM_PROJECT_ID'),
          clientEmail: this.configService.get<string>('FCM_CLIENT_EMAIL'),
          privateKey: this.configService.get<string>('FCM_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
        }),
      });
    }

    await admin.messaging().send({
      token: user.fcmToken,
      notification: { title, body },
    });
  }

  private async sendSms(user: User, body: string) {
    const sid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.configService.get<string>('TWILIO_SMS_FROM');
    if (!sid || !token || !from) {
      this.logger.warn('Twilio SMS is not configured. Skipping SMS notification.');
      return;
    }

    if (!user.phoneNumber) {
      this.logger.warn(`User ${user.id} has no phone number. Skipping SMS notification.`);
      return;
    }

    const client = Twilio(sid, token);
    await client.messages.create({
      to: user.phoneNumber,
      from,
      body,
    });
  }

  private async sendWhatsApp(user: User, body: string) {
    const sid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.configService.get<string>('TWILIO_WHATSAPP_FROM');
    if (!sid || !token || !from) {
      this.logger.warn('Twilio WhatsApp is not configured. Skipping WhatsApp notification.');
      return;
    }

    if (!user.phoneNumber) {
      this.logger.warn(`User ${user.id} has no phone number. Skipping WhatsApp notification.`);
      return;
    }

    const client = Twilio(sid, token);
    await client.messages.create({
      to: `whatsapp:${user.phoneNumber}`,
      from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
      body,
    });
  }
}
