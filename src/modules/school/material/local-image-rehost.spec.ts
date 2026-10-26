/**
 * Pictures saved at an address that only works on the computer that made
 * them (http://localhost:8001/…) are stored publicly before a material is
 * saved, in the Markdown and inside the embedded V2 deck alike.
 */
import { findLocalImageUrls, rehostLocalImages, replaceImageUrls } from './local-image-rehost';
import { SchoolMaterialService } from './school-material.service';

const LOCAL = 'http://localhost:8001/generated-note-images/a1.png';
const LOCAL2 = 'http://127.0.0.1:8001/generated-note-images/b2.png';
const PUBLIC = 'https://pub.example.r2.dev/tenants/inst-1/ppt-slide-images/a1.png';

function deckDescription(slides: any[], markdownImage = '') {
  const b64 = Buffer.from(JSON.stringify({ title: 'Acids', slides }), 'utf8').toString('base64');
  return `## Slide 1: Acids\n- ions\n${markdownImage}\n\n<!-- EDDVA_PPT_V2_DECK:${b64} -->`;
}

function deckOf(description: string) {
  const m = description.match(/<!--\s*EDDVA_PPT_V2_DECK:([A-Za-z0-9+/=]+)\s*-->/);
  return JSON.parse(Buffer.from(m![1], 'base64').toString('utf8'));
}

describe('local-image-rehost', () => {
  it('1. finds local addresses in the Markdown and in the embedded deck', () => {
    const d = deckDescription([{ slideImage: { url: LOCAL } }, { slideImage: { url: LOCAL2 } }], `![image](${LOCAL})`);
    expect(findLocalImageUrls(d).sort()).toEqual([LOCAL2, LOCAL].sort());
  });

  it('2. public addresses are left alone', () => {
    const d = deckDescription([{ slideImage: { url: 'https://dev-api.eddva.in/generated-note-images/x.png' } }]);
    expect(findLocalImageUrls(d)).toEqual([]);
  });

  it('3. replaces both places and re-encodes the deck', () => {
    const d = deckDescription([{ slideImage: { url: LOCAL } }], `![image](${LOCAL})`);
    const out = replaceImageUrls(d, { [LOCAL]: PUBLIC });
    expect(out).not.toContain('localhost');
    expect(out).toContain(`![image](${PUBLIC})`);
    expect(deckOf(out).slides[0].slideImage.url).toBe(PUBLIC);
    expect(deckOf(out).title).toBe('Acids');
  });

  it('4. a picture that cannot be fetched keeps its address; the rest move', async () => {
    const d = deckDescription([{ slideImage: { url: LOCAL } }, { slideImage: { url: LOCAL2 } }]);
    const res = await rehostLocalImages(d, async (u) => (u === LOCAL ? PUBLIC : null));
    expect(res.moved).toBe(1);
    expect(res.failed).toEqual([LOCAL2]);
    const slides = deckOf(res.description as string).slides;
    expect(slides[0].slideImage.url).toBe(PUBLIC);
    expect(slides[1].slideImage.url).toBe(LOCAL2);
  });

  it('5. a store that throws never fails the save', async () => {
    const d = deckDescription([{ slideImage: { url: LOCAL } }]);
    const res = await rehostLocalImages(d, async () => { throw new Error('offline'); });
    expect(res.description).toBe(d);
    expect(res.failed).toEqual([LOCAL]);
  });

  it('6. nothing to do for text with no local address', async () => {
    const store = jest.fn();
    const res = await rehostLocalImages('## Slide 1\n- plain', store);
    expect(store).not.toHaveBeenCalled();
    expect(res.description).toBe('## Slide 1\n- plain');
  });
});

describe('SchoolMaterialService.create — local slide pictures', () => {
  const ADMIN = { id: 'u-1', role: 'INSTITUTE_ADMIN', instituteId: 'inst-1' };
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function makeService() {
    const query = jest.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('INSERT INTO study_materials')) {
        return [{ id: 'm-1', type: params[1], title: params[2], description: params[5], s3_key: params[6] }];
      }
      return [];
    });
    const s3 = { upload: jest.fn(async (key: string) => `https://pub.example.r2.dev/${key}`) };
    const svc = new SchoolMaterialService(
      { query } as any, s3 as any, {} as any, { create: jest.fn() } as any, {} as any, {} as any, {} as any,
    );
    return { svc, query, s3 };
  }

  it('7. saves the deck with public addresses when the picture can be fetched', async () => {
    global.fetch = jest.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200, headers: { 'content-type': 'image/png' },
    })) as any;
    const { svc, s3 } = makeService();
    const res: any = await svc.create(ADMIN, {
      title: 'Acids', fileType: 'ppt', fileUrl: 'https://pub.example.r2.dev/deck.pptx',
      description: deckDescription([{ slideImage: { url: LOCAL } }]),
    });
    expect(s3.upload).toHaveBeenCalledWith('tenants/inst-1/ppt-slide-images/a1.png', expect.any(Buffer), 'image/png');
    expect(res.data.description).not.toContain('localhost');
    expect(deckOf(res.data.description).slides[0].slideImage.url)
      .toBe('https://pub.example.r2.dev/tenants/inst-1/ppt-slide-images/a1.png');
  });

  it('8. still saves when the picture cannot be fetched (deployed server, no local AI service)', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); }) as any;
    const { svc, s3 } = makeService();
    const description = deckDescription([{ slideImage: { url: LOCAL } }]);
    const res: any = await svc.create(ADMIN, { title: 'Acids', fileType: 'ppt', fileUrl: 'x.pptx', description });
    expect(s3.upload).not.toHaveBeenCalled();
    expect(res.data.description).toBe(description);
  });
});
