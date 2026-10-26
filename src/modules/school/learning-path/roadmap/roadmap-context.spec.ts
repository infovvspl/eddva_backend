import { aiRequestStorage, getAiRequestContext } from '../../../../common/context/ai-request-context';
import { withInstitute } from './roadmap.service';

describe('withInstitute (AI calls from the roadmap queue job)', () => {
  it('gives a call made outside any request the institute, so admission control can attribute it', async () => {
    const seen = await withInstitute('inst-1', async () => getAiRequestContext());
    expect(seen.instituteId).toBe('inst-1');
    expect(seen.requestId).toEqual(expect.any(String));
  });

  it('keeps the context of a call already inside a request', async () => {
    const seen = await aiRequestStorage.run({ instituteId: 'from-jwt', userId: 'u1', requestId: 'r1' }, () =>
      withInstitute('other', async () => getAiRequestContext()),
    );
    expect(seen).toEqual({ instituteId: 'from-jwt', userId: 'u1', requestId: 'r1' });
  });

  it('adds nothing when there is no institute to give', async () => {
    expect(await withInstitute(null, async () => getAiRequestContext())).toEqual({});
  });
});
