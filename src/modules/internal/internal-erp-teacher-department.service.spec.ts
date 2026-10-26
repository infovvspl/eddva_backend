import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InternalErpTeacherService } from './internal-erp-teacher.service';

describe('InternalErpTeacherService.updateDepartment', () => {
  const ds = { query: jest.fn() };
  let service: InternalErpTeacherService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InternalErpTeacherService(ds as any, {} as any, {} as any);
  });

  it('rejects a payload missing required fields', async () => {
    await expect(
      service.updateDepartment({ instituteId: 'inst-1', employeeId: '', department: 'Science' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s when the institute does not exist in the LMS', async () => {
    ds.query.mockResolvedValueOnce([]);
    await expect(
      service.updateDepartment({ instituteId: 'inst-1', employeeId: 'E1', department: 'Science' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses when ERP integration is not enabled for the institute', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: false }]);
    await expect(
      service.updateDepartment({ instituteId: 'inst-1', employeeId: 'E1', department: 'Science' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('404s when no LMS teacher matches the employee id', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: true }]);
    ds.query.mockResolvedValueOnce([]);
    await expect(
      service.updateDepartment({ instituteId: 'inst-1', employeeId: 'E1', department: 'Science' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('updates the department for a matching teacher', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: true }]);
    ds.query.mockResolvedValueOnce([{ id: 'teacher-1' }]);
    ds.query.mockResolvedValueOnce(undefined);

    const result = await service.updateDepartment({ instituteId: 'inst-1', employeeId: 'E1', department: 'Science' });

    expect(result).toEqual({ teacherId: 'teacher-1', updated: true });
    expect(ds.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE teachers SET department'), ['Science', 'teacher-1']);
  });
});
