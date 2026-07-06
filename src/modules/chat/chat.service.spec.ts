import { Test, TestingModule } from '@nestjs/testing';
import { CoachingChatService } from './chat.service';
import { ForbiddenException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { SchoolChatGateway } from '../school/chat/school-chat.gateway';
import { CoachingChatGateway } from '../coaching-chat/coaching-chat.gateway';
import { NotificationService } from '../notification/notification.service';
import { getDataSourceToken } from '@nestjs/typeorm';

describe('CoachingChatService - Permissions', () => {
  let service: any;
  let mockQuery: jest.Mock;

  beforeEach(async () => {
    mockQuery = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoachingChatService,
        {
          provide: getDataSourceToken('coaching'),
          useValue: { query: mockQuery },
        },
        { provide: SchoolChatGateway, useValue: {} },
        { provide: CoachingChatGateway, useValue: {} },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn().mockResolvedValue(null) } },
        { provide: NotificationService, useValue: {} },
      ],
    }).compile();

    service = module.get<CoachingChatService>(CoachingChatService);
  });

  describe('assertCanMessage', () => {
    it('Institute Admin -> own Teacher: allowed', async () => {
      await expect(
        service.assertCanMessage('admin1', 'INSTITUTE_ADMIN', 'tenant1', 'teacher1', 'TEACHER', 'tenant1')
      ).resolves.not.toThrow();
    });

    it('Institute Admin -> Teacher in DIFFERENT institute: rejected', async () => {
      await expect(
        service.assertCanMessage('admin1', 'INSTITUTE_ADMIN', 'tenant1', 'teacher1', 'TEACHER', 'tenant2')
      ).rejects.toThrow(ForbiddenException);
    });

    it('Teacher -> Student sharing a batch: allowed', async () => {
      mockQuery.mockResolvedValueOnce([{ '?column?': 1 }]); // Batch check returns a row
      await expect(
        service.assertCanMessage('teacher1', 'TEACHER', 'tenant1', 'student1', 'STUDENT', 'tenant1')
      ).resolves.not.toThrow();
    });

    it('Teacher -> Student NOT sharing any batch: rejected', async () => {
      mockQuery.mockResolvedValueOnce([]); // No shared batch
      await expect(
        service.assertCanMessage('teacher1', 'TEACHER', 'tenant1', 'student1', 'STUDENT', 'tenant1')
      ).rejects.toThrow(ForbiddenException);
    });

    it('Teacher -> Teacher: rejected', async () => {
      await expect(
        service.assertCanMessage('teacher1', 'TEACHER', 'tenant1', 'teacher2', 'TEACHER', 'tenant1')
      ).rejects.toThrow(ForbiddenException);
    });

    it('Student -> Student: rejected', async () => {
      await expect(
        service.assertCanMessage('student1', 'STUDENT', 'tenant1', 'student2', 'STUDENT', 'tenant1')
      ).rejects.toThrow(ForbiddenException);
    });

    it('Super Admin -> Teacher directly: rejected', async () => {
      await expect(
        service.assertCanMessage('super1', 'SUPER_ADMIN', null, 'teacher1', 'TEACHER', 'tenant1')
      ).rejects.toThrow(ForbiddenException);
    });
    
    it('Super Admin -> Institute Admin: allowed (existing exception)', async () => {
      await expect(
        service.assertCanMessage('super1', 'SUPER_ADMIN', null, 'admin1', 'INSTITUTE_ADMIN', 'tenant1')
      ).resolves.not.toThrow();
    });
  });

  describe('getUsers', () => {
    it('Teacher requesting Student contacts: only batch-mates returned', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'student1' }]);
      await service.getUsers({ id: 'teacher1', role: 'TEACHER', tenantId: 'tenant1' }, { role: 'STUDENT' });
      expect(mockQuery).toHaveBeenCalled();
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('EXISTS');
      expect(sql).toContain('JOIN batches b');
    });

    it("Student requesting Teacher contacts: only their batch's teachers returned", async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'teacher1' }]);
      await service.getUsers({ id: 'student1', role: 'STUDENT', tenantId: 'tenant1' }, { role: 'TEACHER' });
      expect(mockQuery).toHaveBeenCalled();
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('EXISTS');
      expect(sql).toContain('JOIN batches b');
    });

    it('Teacher requesting Institute Admin: returns their institute admin(s)', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'admin1' }]);
      await service.getUsers({ id: 'teacher1', role: 'TEACHER', tenantId: 'tenant1' }, { role: 'INSTITUTE_ADMIN' });
      expect(mockQuery).toHaveBeenCalled();
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).not.toContain('EXISTS');
      expect(sql).not.toContain('JOIN batches b');
    });
  });
});
