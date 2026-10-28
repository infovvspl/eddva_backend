import { chapterCompleted, topicCompleted } from './completion';

describe('topicCompleted', () => {
  it('a topic with no subtopics is completed from its own thread', () => {
    expect(topicCompleted(false, [], 'completed')).toBe(true);
    expect(topicCompleted(false, [], 'active')).toBe(false);
    expect(topicCompleted(false, [], null)).toBe(false);
  });

  it('a topic with subtopics ignores its own thread status entirely', () => {
    expect(topicCompleted(true, ['completed', 'completed'], 'completed')).toBe(true);
    expect(topicCompleted(true, ['completed'], 'active')).toBe(true); // own thread status irrelevant once it has subtopics
  });

  it('a topic with subtopics is completed only once every one of them is', () => {
    expect(topicCompleted(true, ['completed', 'completed'], null)).toBe(true);
    expect(topicCompleted(true, ['completed', 'active'], null)).toBe(false);
    expect(topicCompleted(true, ['completed', null], null)).toBe(false);
  });

  it('a topic reported as having subtopics but with none passed is not completed (no vacuous truth)', () => {
    expect(topicCompleted(true, [], null)).toBe(false);
  });
});

describe('chapterCompleted', () => {
  it('is complete only once every topic of the full roster is', () => {
    expect(chapterCompleted([true, true, true])).toBe(true);
    expect(chapterCompleted([true, false, true])).toBe(false);
  });

  it('an empty roster (no roadmap yet) is never complete', () => {
    expect(chapterCompleted([])).toBe(false);
  });
});
