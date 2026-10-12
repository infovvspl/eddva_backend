import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InternalErpTeacherService } from './internal-erp-teacher.service';

describe('InternalErpTeacherService.updateStatus', () => {
  const ds = { query: jest.fn() };
  let service: InternalErpTeacherService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InternalErpTeacherService(ds as any, {} as any, {} as any);
  });

  it('rejects a payload missing required fields', async () => {
    await expect(
      service.updateStatus({ instituteId: '', employeeId: 'E1', status: 'INACTIVE' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s when the institute does not exist in the LMS', async () => {
    ds.query.mockResolvedValueOnce([]);
    await expect(
      service.updateStatus({ instituteId: 'inst-1', employeeId: 'E1', status: 'INACTIVE' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses when ERP integration is not enabled for the institute', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: false }]);
    await expect(
      service.updateStatus({ instituteId: 'inst-1', employeeId: 'E1', status: 'INACTIVE' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('404s when no LMS teacher matches the employee id', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: true }]);
    ds.query.mockResolvedValueOnce([]);
    await expect(
      service.updateStatus({ instituteId: 'inst-1', employeeId: 'E1', status: 'INACTIVE' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deactivates the login when status is INACTIVE', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: true }]);
    ds.query.mockResolvedValueOnce([{ id: 'teacher-1', user_id: 'user-1' }]);
    ds.query.mockResolvedValueOnce(undefined);

    const result = await service.updateStatus({ instituteId: 'inst-1', employeeId: 'E1', status: 'INACTIVE' });

    expect(result).toEqual({ teacherId: 'teacher-1', updated: true });
    expect(ds.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE users SET is_active'), [false, 'user-1']);
  });

  it('reactivates the login when status is ACTIVE', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: true }]);
    ds.query.mockResolvedValueOnce([{ id: 'teacher-1', user_id: 'user-1' }]);
    ds.query.mockResolvedValueOnce(undefined);

    await service.updateStatus({ instituteId: 'inst-1', employeeId: 'E1', status: 'ACTIVE' });

    expect(ds.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE users SET is_active'), [true, 'user-1']);
  });
});
