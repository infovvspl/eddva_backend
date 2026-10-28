import { alignRoadmap, alignSubtopics, fallbackRoadmap } from './roadmap-align';

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

describe('alignSubtopics', () => {
  const existing = [
    { id: 's1', name: 'Bar magnet field' },
    { id: 's2', name: 'Field line properties' },
  ];

  it('reuses an existing id for an exact (normalized) name match', () => {
    const { subtopics, matches } = alignSubtopics(['Bar magnet field', 'Field line properties'], existing);
    expect(subtopics).toEqual([
      { ord: 1, name: 'Bar magnet field' },
      { ord: 2, name: 'Field line properties' },
    ]);
    expect(matches.get(1)).toBe('s1');
    expect(matches.get(2)).toBe('s2');
  });

  it('matches case- and whitespace-insensitively', () => {
    const { matches } = alignSubtopics(['  bar MAGNET field  '], existing);
    expect(matches.get(1)).toBe('s1');
  });

  it('gives a genuinely new name a new row (no match)', () => {
    const { subtopics, matches } = alignSubtopics(['Electromagnetic induction'], existing);
    expect(subtopics).toEqual([{ ord: 1, name: 'Electromagnetic induction' }]);
    expect(matches.has(1)).toBe(false);
  });

  it('retires, but never deletes, an existing row the AI no longer returns', () => {
    const { retired } = alignSubtopics(['Bar magnet field'], existing);
    expect(retired).toEqual(['s2']);
  });

  it('reorders an existing row by matching it at its new position, not deleting it', () => {
    const { subtopics, matches, retired } = alignSubtopics(['Field line properties', 'Bar magnet field'], existing);
    expect(subtopics).toEqual([
      { ord: 1, name: 'Field line properties' },
      { ord: 2, name: 'Bar magnet field' },
    ]);
    expect(matches.get(1)).toBe('s2');
    expect(matches.get(2)).toBe('s1');
    expect(retired).toEqual([]);
  });

  it('dedupes, trims and caps at 8, same as topic subtopics', () => {
    const many = Array.from({ length: 10 }, (_, i) => `Concept ${i}`);
    const { subtopics } = alignSubtopics([...many, ' Concept 0 '], []);
    expect(subtopics).toHaveLength(8);
    expect(subtopics[0]).toEqual({ ord: 1, name: 'Concept 0' });
  });

  it('copes with junk', () => {
    expect(alignSubtopics(null as any, existing)).toEqual({ subtopics: [], matches: new Map(), retired: ['s1', 's2'] });
  });
});
