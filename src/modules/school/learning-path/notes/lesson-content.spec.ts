import { lessonTitleStale } from './lesson-content';

describe('lessonTitleStale', () => {
  it('is stale when the markdown heading does not match the expected title (a pre-fix subtopic lesson)', () => {
    const markdown = '# Magnetic Field and Field Lines\n\n## Core Concepts\n...';
    expect(lessonTitleStale(markdown, 'Bar magnet field')).toBe(true);
  });

  it('is not stale once the heading matches (case- and whitespace-insensitively)', () => {
    const markdown = '#   Bar Magnet Field  \n\n## Core Concepts\n...';
    expect(lessonTitleStale(markdown, 'bar magnet field')).toBe(false);
  });

  it('is not stale for an ordinary topic lesson, whose heading always matched its own name', () => {
    const markdown = '# Magnetic Field and Field Lines\n\n## Core Concepts\n...';
    expect(lessonTitleStale(markdown, 'Magnetic Field and Field Lines')).toBe(false);
  });

  it('leaves no-heading or empty markdown alone (shouldRegenerateLesson already catches those)', () => {
    expect(lessonTitleStale('', 'Bar magnet field')).toBe(false);
    expect(lessonTitleStale('Core Concepts without a heading line', 'Bar magnet field')).toBe(false);
    expect(lessonTitleStale(null, 'Bar magnet field')).toBe(false);
  });
});
