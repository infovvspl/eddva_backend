import { GoneException } from '@nestjs/common';
import { SchoolSyllabusController } from './school-syllabus.controller';

describe('retired AI lesson brief', () => {
  it('answers 410 and never reaches the AI (the brief went through the router, which can fall back to Gemini)', () => {
    const svc = { generateAiLessonTemplate: jest.fn() };
    const controller = new SchoolSyllabusController(svc as any);
    expect(() => controller.generateAiLessonTemplate({ id: 'u' })).toThrow(GoneException);
    expect(svc.generateAiLessonTemplate).not.toHaveBeenCalled();
  });
});
