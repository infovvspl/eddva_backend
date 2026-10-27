import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InternalPlatformAiUsageController } from './internal-platform-ai-usage.controller';

describe('InternalPlatformAiUsageController', () => {
  const saved = process.env.INTERNAL_API_KEY;
  beforeEach(() => { process.env.INTERNAL_API_KEY = 'secret-key'; });
  afterAll(() => { saved === undefined ? delete process.env.INTERNAL_API_KEY : (process.env.INTERNAL_API_KEY = saved); });

  const make = () => {
    const usage = {
      getDashboard: jest.fn(async () => ({ totalRequests: 10 })),
      getByInstitute: jest.fn(async () => [{ institute_id: 'i-1', requests: 10 }]),
    };
    return { usage, controller: new InternalPlatformAiUsageController(usage as any) };
  };

  it('refuses a missing or wrong internal key, without touching any data', async () => {
    const { usage, controller } = make();
    await expect(controller.summary(undefined as any)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.summary('nope')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usage.getDashboard).not.toHaveBeenCalled();
  });

  it('fails closed when the server has no key configured', async () => {
    delete process.env.INTERNAL_API_KEY;
    const { controller } = make();
    await expect(controller.summary('')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown period', async () => {
    const { controller } = make();
    await expect(controller.summary('secret-key', 'decade')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the dashboard and the per-institute breakdown for the period, across both products', async () => {
    const { usage, controller } = make();
    const res = await controller.summary('secret-key', 'week');
    expect(res).toEqual({ period: 'week', dashboard: { totalRequests: 10 }, byInstitute: [{ institute_id: 'i-1', requests: 10 }] });
    expect(usage.getDashboard).toHaveBeenCalledWith('all', 'week');
    expect(usage.getByInstitute).toHaveBeenCalledWith('all', 'week', 'cost');
  });
});
