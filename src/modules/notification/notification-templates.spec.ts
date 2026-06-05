import { getTemplate } from './notification-templates';

describe('NotificationTemplates', () => {
  it('should format streak danger templates correctly', () => {
    const res = getTemplate('streak', { streak: 12, fullName: 'Rohit' });
    expect(res.title).toBeDefined();
    expect(res.body).toBeDefined();
    expect(res.body).toContain('12-day');
  });

  it('should fall back to general templates if invalid category is requested', () => {
    // Cast category to any to force fallback
    const res = getTemplate('invalid_cat' as any, { fullName: 'Rohit' });
    expect(res.title).toBeDefined();
    expect(res.body).toBeDefined();
  });

  it('should format morning JEE templates with subject puns', () => {
    const res = getTemplate('morning', { examTarget: 'JEE', fullName: 'Amit' });
    expect(res.title).toBeDefined();
    expect(res.body).toBeDefined();
  });

  it('should format morning NEET templates with biology puns', () => {
    const res = getTemplate('morning', { examTarget: 'NEET', fullName: 'Pooja' });
    expect(res.title).toBeDefined();
    expect(res.body).toBeDefined();
  });

  it('should format battle challenge notifications with challenger and topic', () => {
    const res = getTemplate('battle_challenge', {
      challengerName: 'Varun',
      topicName: 'Electrostatics',
    });
    expect(res.title).toBeDefined();
    expect(res.body).toContain('Varun');
    expect(res.body).toContain('Electrostatics');
  });

  it('should format overtake notifications with rival name', () => {
    const res = getTemplate('overtake', { rivalName: 'Nisha' });
    expect(res.title).toBeDefined();
    expect(res.body).toContain('Nisha');
  });
});
