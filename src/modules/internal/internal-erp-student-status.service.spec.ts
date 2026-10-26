import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InternalErpStudentService } from './internal-erp-student.service';

// SchoolStudentService now imports the document generator, which loads puppeteer
// (ESM, not transformed by ts-jest). Nothing here renders a PDF.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

describe('InternalErpStudentService.updateStatus', () => {
  const ds = { query: jest.fn() };
  let service: InternalErpStudentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InternalErpStudentService(ds as any, {} as any, {} as any);
  });

  it('rejects a payload missing required fields', async () => {
    await expect(
      service.updateStatus({ instituteId: '', enrollmentNumber: 'E1', status: 'GRADUATED' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s when the institute does not exist in the LMS', async () => {
    ds.query.mockResolvedValueOnce([]);
    await expect(
      service.updateStatus({ instituteId: 'inst-1', enrollmentNumber: 'E1', status: 'GRADUATED' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses when ERP integration is not enabled for the institute', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: false }]);
    await expect(
      service.updateStatus({ instituteId: 'inst-1', enrollmentNumber: 'E1', status: 'GRADUATED' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('404s when no LMS student matches the enrollment number', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: true }]);
    ds.query.mockResolvedValueOnce([]);
    await expect(
      service.updateStatus({ instituteId: 'inst-1', enrollmentNumber: 'E1', status: 'GRADUATED' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('marks the student GRADUATED and deactivates their login', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: true }]);
    ds.query.mockResolvedValueOnce([{ id: 'student-1', user_id: 'user-1' }]);
    ds.query.mockResolvedValueOnce(undefined);
    ds.query.mockResolvedValueOnce(undefined);

    const result = await service.updateStatus({
      instituteId: 'inst-1',
      enrollmentNumber: 'E1',
      status: 'GRADUATED',
    });

    expect(result).toEqual({ studentId: 'student-1', updated: true });
    expect(ds.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE students SET status'), ['GRADUATED', 'student-1']);
    expect(ds.query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE users SET is_active'), [false, 'user-1']);
  });

  it('reactivates the login when status is set back to ACTIVE', async () => {
    ds.query.mockResolvedValueOnce([{ id: 'inst-1', erp_enabled: true }]);
    ds.query.mockResolvedValueOnce([{ id: 'student-1', user_id: 'user-1' }]);
    ds.query.mockResolvedValueOnce(undefined);
    ds.query.mockResolvedValueOnce(undefined);

    await service.updateStatus({ instituteId: 'inst-1', enrollmentNumber: 'E1', status: 'ACTIVE' });

    expect(ds.query).toHaveBeenNthCalledWith(4, expect.stringContaining('UPDATE users SET is_active'), [true, 'user-1']);
  });
});
