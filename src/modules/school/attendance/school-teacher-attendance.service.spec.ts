import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SchoolTeacherAttendanceService } from './school-teacher-attendance.service';

describe('SchoolTeacherAttendanceService — self check-in/out', () => {
  // A plain weekday outside any fixed HOLIDAYS_2026/VACATIONS_2026 entry —
  // "today" during a real run can land inside one (e.g. Durga Puja Vacation
  // spans Oct 17-24), which would wrongly fail these checkIn/biometric tests
  // on the holiday guard instead of the geofence logic under test.
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: false }).setSystemTime(new Date('2026-06-16T09:00:00+05:30'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const instituteId = 'inst-1';
  const teacherUserId = 'teacher-1';
  const user = { id: teacherUserId, instituteId };

  // Campus at (12.9716, 77.5946), 100m radius, no work-start-time configured
  // unless a test overrides it.
  const campusRow = {
    campus_latitude: '12.9716000',
    campus_longitude: '77.5946000',
    campus_radius_meters: 100,
    work_start_time: null,
    late_threshold_minutes: null,
  };

  function buildService(queryImpl: (sql: string, params?: any[]) => any) {
    const ds: any = { query: jest.fn(queryImpl) };
    const notificationService: any = { create: jest.fn() };
    return new SchoolTeacherAttendanceService(ds, notificationService);
  }

  describe('checkIn', () => {
    it('rejects when outside the campus radius', async () => {
      const svc = buildService((sql: string) => {
        if (sql.includes('FROM institutes')) return Promise.resolve([campusRow]);
        if (sql.includes('FROM events')) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      // ~1.5km away from the campus point used above.
      await expect(svc.checkIn(user, { latitude: 12.9816, longitude: 77.6046 })).rejects.toThrow(BadRequestException);
    });

    it('rejects when the institute has not configured a campus location', async () => {
      const svc = buildService((sql: string) => {
        if (sql.includes('FROM institutes')) return Promise.resolve([{ ...campusRow, campus_latitude: null, campus_longitude: null, campus_radius_meters: null }]);
        if (sql.includes('FROM events')) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await expect(svc.checkIn(user, { latitude: 12.9716, longitude: 77.5946 })).rejects.toThrow('Campus location is not configured');
    });

    it('marks present and writes a GEOFENCE row when inside the radius', async () => {
      const inserted: any[] = [];
      const svc = buildService((sql: string, params?: any[]) => {
        if (sql.includes('FROM institutes')) return Promise.resolve([campusRow]);
        if (sql.includes('FROM events')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO teacher_attendance')) {
          inserted.push(params);
          return Promise.resolve([{ id: 'row-1', status: params![3], method: 'GEOFENCE', checkInTime: params![4] }]);
        }
        if (sql.includes('FROM teacher_attendance WHERE institute_id')) return Promise.resolve([{ attended: '0', total: '0' }]);
        return Promise.resolve([]);
      });

      const result = await svc.checkIn(user, { latitude: 12.9716, longitude: 77.5946 });
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('present');
      expect(result.data.method).toBe('GEOFENCE');
      expect(result.distanceMeters).toBeLessThan(5);
    });

    it('marks late when checking in after the work-start time + threshold', async () => {
      const lateCampus = { ...campusRow, work_start_time: '00:00', late_threshold_minutes: 0 };
      const svc = buildService((sql: string, params?: any[]) => {
        if (sql.includes('FROM institutes')) return Promise.resolve([lateCampus]);
        if (sql.includes('FROM events')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO teacher_attendance')) {
          return Promise.resolve([{ id: 'row-1', status: params![3], method: 'GEOFENCE', checkInTime: params![4] }]);
        }
        if (sql.includes('FROM teacher_attendance WHERE institute_id')) return Promise.resolve([{ attended: '0', total: '0' }]);
        return Promise.resolve([]);
      });

      // Work starts at 00:00 with 0min grace — any check-in time today is "late".
      const result = await svc.checkIn(user, { latitude: 12.9716, longitude: 77.5946 });
      expect(result.data.status).toBe('late');
    });
  });

  describe('checkOut', () => {
    it('404s when the teacher never checked in today', async () => {
      const svc = buildService((sql: string) => {
        if (sql.startsWith('SELECT id FROM teacher_attendance')) return Promise.resolve([]);
        return Promise.resolve([]);
      });
      await expect(svc.checkOut(user)).rejects.toThrow(NotFoundException);
    });

    it('sets check_out_time when a check-in row exists', async () => {
      const svc = buildService((sql: string) => {
        if (sql.startsWith('SELECT id FROM teacher_attendance')) return Promise.resolve([{ id: 'row-1' }]);
        if (sql.startsWith('UPDATE teacher_attendance SET check_out_time')) {
          return Promise.resolve([{ id: 'row-1', status: 'present', method: 'GEOFENCE', checkInTime: new Date(), checkOutTime: new Date() }]);
        }
        return Promise.resolve([]);
      });
      const result = await svc.checkOut(user);
      expect(result.success).toBe(true);
      expect(result.data.checkOutTime).toBeTruthy();
    });
  });

  describe('biometricCheckIn', () => {
    it('404s when the employeeId does not resolve to a teacher at the institute', async () => {
      const svc = buildService((sql: string) => {
        if (sql.includes('FROM teachers t JOIN users u')) return Promise.resolve([]);
        return Promise.resolve([]);
      });
      await expect(
        svc.biometricCheckIn({ instituteId, employeeId: 'UNKNOWN-1', eventType: 'IN' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects OUT when there is no check-in row for today', async () => {
      const svc = buildService((sql: string) => {
        if (sql.includes('FROM teachers t JOIN users u')) return Promise.resolve([{ userId: teacherUserId }]);
        if (sql.startsWith('UPDATE teacher_attendance SET check_out_time')) return Promise.resolve([]);
        return Promise.resolve([]);
      });
      await expect(
        svc.biometricCheckIn({ instituteId, employeeId: 'EMP-1', eventType: 'OUT' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a BIOMETRIC row for a valid IN event', async () => {
      const svc = buildService((sql: string) => {
        if (sql.includes('FROM teachers t JOIN users u')) return Promise.resolve([{ userId: teacherUserId }]);
        if (sql.includes('FROM events')) return Promise.resolve([]);
        if (sql.includes('FROM institutes')) return Promise.resolve([campusRow]);
        if (sql.includes('INSERT INTO teacher_attendance')) return Promise.resolve([]);
        if (sql.includes('FROM teacher_attendance WHERE institute_id')) return Promise.resolve([{ attended: '0', total: '0' }]);
        return Promise.resolve([]);
      });
      const result = await svc.biometricCheckIn({ instituteId, employeeId: 'EMP-1', eventType: 'IN', deviceId: 'gate-1' });
      expect(result.success).toBe(true);
      expect(result.eventType).toBe('IN');
    });
  });
});
