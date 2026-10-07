import { InternalAiUsageService } from './internal-ai-usage.service';

/**
 * The AI service reports only `modelUsed`, which was written into BOTH the
 * provider and model columns. Once routing started returning provider-qualified
 * ids ("together:zai-org/GLM-5.3-Flash", 30 chars) that overflowed provider's
 * VARCHAR(24): on 2026-09-28 a real PPT generation succeeded while its usage row
 * failed with "value too long for type character varying(24)", so every routed
 * call was missing from usage and cost reporting.
 */
describe('InternalAiUsageService — provider attribution', () => {
  const providerOf = InternalAiUsageService.providerOf;

  it('takes the provider from a routed, provider-qualified id', () => {
    expect(providerOf('together:zai-org/GLM-5.3-Flash')).toBe('together');
    expect(providerOf('together:Qwen/Qwen3.8-Flash')).toBe('together');
    expect(providerOf('together:openai/gpt-oss-120b')).toBe('together');
  });

  it('keeps the full model id short enough to store as a provider', () => {
    expect(providerOf('together:zai-org/GLM-5.3-Flash')!.length).toBeLessThanOrEqual(24);
  });

  it('maps the historical unprefixed ids', () => {
    expect(providerOf('gemini-2.5-flash')).toBe('gemini');
    expect(providerOf('openai/gpt-oss-120b')).toBe('groq');
    expect(providerOf('openai/gpt-oss-20b')).toBe('groq');
    expect(providerOf('qwen/qwen3-32b')).toBe('groq');
    expect(providerOf('scientific_solver')).toBe('groq');
  });

  it('returns null rather than guessing at an unknown id', () => {
    expect(providerOf('some-new-model')).toBeNull();
    expect(providerOf('')).toBeNull();
    expect(providerOf(undefined)).toBeNull();
    expect(providerOf(null)).toBeNull();
  });

  it('logUsage records the provider separately from the model', async () => {
    const aiUsage = { record: jest.fn().mockResolvedValue(undefined) };
    const svc = new InternalAiUsageService(aiUsage as any);

    await svc.logUsage({
      instituteId: '11111111-1111-1111-1111-111111111111',
      instituteType: 'school',
      featureId: 'ppt_generate',
      featureCategory: 'content',
      modelUsed: 'together:zai-org/GLM-5.3-Flash',
      tokensInput: 5287,
      tokensOutput: 1150,
    } as any);

    const row = aiUsage.record.mock.calls[0][0];
    expect(row.provider).toBe('together');
    expect(row.model).toBe('together:zai-org/GLM-5.3-Flash');
    expect(row.totalTokens).toBe(6437);
  });
});
