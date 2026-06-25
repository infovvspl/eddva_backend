import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between } from 'typeorm';

import { Student } from '../../database/entities/student.entity';
import { CoachingNotificationService } from './notification.service';
import { CoachingNotificationType } from './notification.types';

import { StudyPlan, PlanItem, LectureProgress, PlanItemStatus, PlanItemType } from '../../database/entities/learning.entity';
import { MockTest, TestSession, TestSessionStatus } from '../../database/entities/assessment.entity';

@Injectable()
export class CoachingNotificationScheduler {
  private readonly logger = new Logger(CoachingNotificationScheduler.name);

  constructor(
    private readonly notificationService: CoachingNotificationService,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(StudyPlan, 'coaching')
    private readonly studyPlanRepo: Repository<StudyPlan>,
    @InjectRepository(PlanItem, 'coaching')
    private readonly planItemRepo: Repository<PlanItem>,
    @InjectRepository(LectureProgress, 'coaching')
    private readonly lectureProgressRepo: Repository<LectureProgress>,
    @InjectRepository(MockTest, 'coaching')
    private readonly mockTestRepo: Repository<MockTest>,
    @InjectRepository(TestSession, 'coaching')
    private readonly testSessionRepo: Repository<TestSession>,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'Asia/Kolkata' })
  async handleGoodMorning() {
    this.logger.log('Running GOOD_MORNING cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true }, relations: ['user'] });
    for (const student of students) {
      const name = student.user?.fullName?.split(' ')[0] || 'Student';
      const activePlan = await this.studyPlanRepo.findOne({
        where: { studentId: student.id, validUntil: MoreThan(new Date()) },
        order: { generatedAt: 'DESC' }
      });

      if (activePlan) {
        const today = new Date().toISOString().split('T')[0];
        const taskCount = await this.planItemRepo.count({
          where: { studyPlanId: activePlan.id, scheduledDate: today }
        });
        const classCount = await this.planItemRepo.count({
          where: { studyPlanId: activePlan.id, scheduledDate: today, type: PlanItemType.LECTURE }
        });
        
        if (taskCount > 0 || classCount > 0) {
          await this.notificationService.sendNotification(student, CoachingNotificationType.GOOD_MORNING_WITH_PLAN, {
            name,
            taskCount: taskCount.toString(),
            classCount: classCount.toString()
          });
        } else {
          await this.notificationService.sendNotification(student, CoachingNotificationType.GOOD_MORNING, {
            name,
          });
        }
      } else {
        await this.notificationService.sendNotification(student, CoachingNotificationType.GOOD_MORNING, {
          name,
        });
      }
    }
  }

  @Cron('0 12 * * *', { timeZone: 'Asia/Kolkata' })
  async handleGoodAfternoon() {
    this.logger.log('Running GOOD_AFTERNOON cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true }, relations: ['user'] });
    for (const student of students) {
      const name = student.user?.fullName?.split(' ')[0] || 'Student';
      await this.notificationService.sendNotification(student, CoachingNotificationType.GOOD_AFTERNOON, { name });
    }
  }

  @Cron('30 21 * * *', { timeZone: 'Asia/Kolkata' })
  async handleGoodNight() {
    this.logger.log('Running GOOD_NIGHT cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true }, relations: ['user'] });
    for (const student of students) {
      const name = student.user?.fullName?.split(' ')[0] || 'Student';
      await this.notificationService.sendNotification(student, CoachingNotificationType.GOOD_NIGHT, { name });
    }
  }

  @Cron('0 17 * * *', { timeZone: 'Asia/Kolkata' })
  async handleVideoIncomplete() {
    this.logger.log('Running VIDEO_INCOMPLETE cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true }, relations: ['user'] });
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const student of students) {
      const name = student.user?.fullName?.split(' ')[0] || 'Student';
      const recentProgress = await this.lectureProgressRepo.findOne({
        where: { 
          studentId: student.id, 
          watchPercentage: Between(20, 80), 
          isCompleted: false,
          updatedAt: MoreThan(sevenDaysAgo)
        },
        order: { updatedAt: 'DESC' },
        relations: ['lecture']
      });

      if (recentProgress) {
        await this.notificationService.sendNotification(student, CoachingNotificationType.VIDEO_INCOMPLETE, {
          name,
          subject: recentProgress.lecture?.title || 'your',
          percentage: Math.round(recentProgress.watchPercentage).toString()
        });
      }
    }
  }

  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async handleMissedTest() {
    this.logger.log('Running MISSED_TEST cron');
    const yesterdayStart = new Date();
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setHours(23, 59, 59, 999);

    const missedTests = await this.mockTestRepo.find({
      where: { deadlineAt: Between(yesterdayStart, yesterdayEnd) }
    });

    for (const test of missedTests) {
      if (!test.batchId) continue;
      
      const studentsInBatch = await this.studentRepo.createQueryBuilder('student')
        .leftJoinAndSelect('student.user', 'user')
        .innerJoin('enrollments', 'enrollment', 'enrollment.student_id = student.id')
        .where('enrollment.batch_id = :batchId', { batchId: test.batchId })
        .andWhere('enrollment.status = :status', { status: 'active' })
        .andWhere('student.notification_enabled = :notif', { notif: true })
        .getMany();

      for (const student of studentsInBatch) {
        const name = student.user?.fullName?.split(' ')[0] || 'Student';

        const session = await this.testSessionRepo.findOne({
          where: { studentId: student.id, mockTestId: test.id, status: TestSessionStatus.SUBMITTED }
        });

        if (!session) {
          await this.notificationService.sendNotification(student, CoachingNotificationType.MISSED_TEST, {
            name,
            testName: test.title
          });
        }
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTestStartingSoon() {
    this.logger.log('Running TEST_STARTING_SOON cron');
    const now = new Date();
    const in32Mins = new Date(now.getTime() + 32 * 60000);

    const upcomingTests = await this.mockTestRepo.find({
      where: { scheduledAt: Between(now, in32Mins) }
    });

    for (const test of upcomingTests) {
      if (!test.batchId) continue;

      const studentsInBatch = await this.studentRepo.createQueryBuilder('student')
        .leftJoinAndSelect('student.user', 'user')
        .innerJoin('enrollments', 'enrollment', 'enrollment.student_id = student.id')
        .where('enrollment.batch_id = :batchId', { batchId: test.batchId })
        .andWhere('enrollment.status = :status', { status: 'active' })
        .andWhere('student.notification_enabled = :notif', { notif: true })
        .getMany();

      for (const student of studentsInBatch) {
        const name = student.user?.fullName?.split(' ')[0] || 'Student';

        const session = await this.testSessionRepo.findOne({
          where: { studentId: student.id, mockTestId: test.id }
        });

        if (!session) {
          await this.notificationService.sendNotification(student, CoachingNotificationType.TEST_STARTING_SOON, {
            name,
            testName: test.title
          });
        }
      }
    }
  }

  @Cron('0 10 * * *', { timeZone: 'Asia/Kolkata' })
  async handleStudyPlanPending() {
    this.logger.log('Running STUDY_PLAN_PENDING cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true }, relations: ['user'] });
    const today = new Date().toISOString().split('T')[0];

    for (const student of students) {
      const name = student.user?.fullName?.split(' ')[0] || 'Student';
      const activePlan = await this.studyPlanRepo.findOne({
        where: { studentId: student.id, validUntil: MoreThan(new Date()) },
        order: { generatedAt: 'DESC' }
      });

      if (activePlan) {
        const pendingCount = await this.planItemRepo.count({
          where: { studyPlanId: activePlan.id, scheduledDate: today, status: PlanItemStatus.PENDING }
        });

        if (pendingCount > 0) {
          await this.notificationService.sendNotification(student, CoachingNotificationType.STUDY_PLAN_PENDING, {
            name,
            taskCount: pendingCount.toString()
          });
        }
      }
    }
  }

  @Cron('0 8 * * *', { timeZone: 'Asia/Kolkata' })
  async handleNoStudyPlan() {
    this.logger.log('Running NO_STUDY_PLAN cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true }, relations: ['user'] });

    for (const student of students) {
      const name = student.user?.fullName?.split(' ')[0] || 'Student';
      const activePlan = await this.studyPlanRepo.findOne({
        where: { studentId: student.id, validUntil: MoreThan(new Date()) }
      });

      if (!activePlan) {
        await this.notificationService.sendNotification(student, CoachingNotificationType.NO_STUDY_PLAN, {
          name
        });
      }
    }
  }

  @Cron('0 19 * * *', { timeZone: 'Asia/Kolkata' })
  async handleTestInsight() {
    this.logger.log('Running TEST_INSIGHT cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true }, relations: ['user'] });
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    for (const student of students) {
      const name = student.user?.fullName?.split(' ')[0] || 'Student';
      const recentSession = await this.testSessionRepo.findOne({
        where: { 
          studentId: student.id, 
          submittedAt: Between(todayStart, todayEnd)
        },
        order: { submittedAt: 'DESC' }
      });

      if (recentSession && recentSession.errorBreakdown) {
        const conceptualErrors = recentSession.errorBreakdown.conceptual || 0;
        if (conceptualErrors > 3) {
          await this.notificationService.sendNotification(student, CoachingNotificationType.TEST_INSIGHT, {
            name,
            errorCount: conceptualErrors.toString()
          });
        }
      }
    }
  }
}
