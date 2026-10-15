import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InternalErpTeacherService } from './internal-erp-teacher.service';

describe('InternalErpTeacherService.listForInstitute', () => {
  const ds = { query: jest.fn() };
  let service: InternalErpTeacherService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InternalErpTeacherService(ds as any, {} as any, {} as any);
  });

  it('404s when the institute does not exist in the LMS', async () => {
    ds.query.mockResolvedValueOnce([]);
    await expect(service.listForInstitute('inst-1')).rejects.toThrow(NotFoundException);
  });

  it('refuses when ERP integration is not enabled for the institute', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: false }]);
    await expect(service.listForInstitute('inst-1')).rejects.toThrow(ForbiddenException);
  });

  it('returns the mapped teacher list', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: true }]);
    ds.query.mockResolvedValueOnce([
      { teacher_id: 't-1', employee_id: 'STF-1', department: 'Science', name: 'Aarav', email: 'a@x.com', is_active: true },
    ]);

    const result = await service.listForInstitute('inst-1');

    expect(result).toEqual([
      { teacherId: 't-1', employeeId: 'STF-1', name: 'Aarav', email: 'a@x.com', department: 'Science', isActive: true },
    ]);
  });
});
