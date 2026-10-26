import { alignRoadmap, fallbackRoadmap } from './roadmap-align';

const recorded = [
  { id: 'r1', name: 'MAGNETIC FIELD AND FIELD LINES' },
  { id: 'r2', name: ' MAGNETIC FIELD DUE TO A CURRENT---CCCARRYING CONDUCTOR' },
  { id: 'r3', name: 'Domestic circuits' },
  { id: 'r4', name: 'History of magnets in ancient China' },
];

describe('alignRoadmap', () => {
  const ai = [
    { topic: 'Magnetic field and field lines', subtopics: ['Bar magnet field', 'Field line properties'], covers: ['magnetic field and field lines'] },
    { topic: 'Field due to a current-carrying conductor', subtopics: ['Straight conductor', 'Solenoid', 'Solenoid'], covers: [] },
    { topic: 'Domestic electric circuits', subtopics: ['Fuse', 'Earthing'], covers: ['Domestic circuits', 'MAGNETIC FIELD AND FIELD LINES'] },
    { topic: 'magnetic field and field lines!', subtopics: ['dup'] },
    { topic: '  ', subtopics: [] },
  ];

  it('keeps the AI order, drops duplicates and blanks, and dedupes subtopics', () => {
    const { topics } = alignRoadmap(ai, recorded);
    expect(topics.map((t) => [t.ord, t.name])).toEqual([
      [1, 'Magnetic field and field lines'],
      [2, 'Field due to a current-carrying conductor'],
      [3, 'Domestic electric circuits'],
    ]);
    expect(topics[1].subtopics).toEqual(['Straight conductor', 'Solenoid']);
  });

  it("links recorded topics by the AI's covers, each once, then by shared words", () => {
    const { links } = alignRoadmap(ai, recorded);
    expect(links.get('r1')).toBe(1); // first claim wins
    expect(links.get('r3')).toBe(3);
    expect(links.get('r2')).toBe(2); // "current carrying conductor" overlaps topic 2
    expect(links.has('r4')).toBe(false); // nothing matches: counts for the chapter
  });

  it('copes with junk', () => {
    expect(alignRoadmap(null as any, recorded)).toEqual({ topics: [], links: new Map() });
  });

  it('caps the number of topics', () => {
    expect(alignRoadmap(Array.from({ length: 20 }, (_, i) => ({ topic: `T${i}`, subtopics: [] })), []).topics).toHaveLength(12);
  });
});

describe('fallbackRoadmap', () => {
  it('is the chapter as one topic covering every recorded topic', () => {
    const fb = fallbackRoadmap(' Light ', recorded);
    expect(fb.topics).toEqual([{ ord: 1, name: 'Light', subtopics: [] }]);
    expect([...fb.links.values()]).toEqual([1, 1, 1, 1]);
  });
});
