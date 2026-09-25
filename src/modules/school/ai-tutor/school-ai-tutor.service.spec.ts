import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SchoolAiTutorService } from './school-ai-tutor.service';

const STUDENT = { student_id: 'stu-1', section_id: 'sec-1', class_id: 'class-8', class_name: 'Class 8' };
const USER = { id: 'user-1', instituteId: 'inst-1', role: 'STUDENT' };
const CONV = {
  id: 'conv-1', student_id: 'stu-1', subject_id: 'sub-sci', chapter_id: 'chap-fp', topic_id: null,
  subject_name: 'Science', chapter_name: 'Force and Pressure', topic_name: null,
};

/** A DataSource stand-in that answers queries by matching SQL fragments. */
function makeDs(overrides: { testInProgress?: boolean; sentToday?: number; conv?: any; subjects?: any[]; quizRows?: any[] } = {}) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const answer = async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('CREATE TABLE')) return [];
    if (sql.includes('FROM students s')) return [STUDENT];
    if (sql.includes('FROM school_ai_tutor_conversations c') && sql.includes('WHERE c.id = $1')) {
      return overrides.conv === null ? [] : [overrides.conv ?? CONV];
    }
    if (sql.includes('FROM assessment_submissions')) return overrides.testInProgress ? [{ '?column?': 1 }] : [];
    if (sql.includes('COUNT(*)::int AS n')) return [{ n: overrides.sentToday ?? 0 }];
    if (sql.includes('SELECT role, content FROM school_ai_tutor_messages')) {
      // newest first, as the query orders it
      return [{ role: 'tutor', content: 'Force per unit area.' }, { role: 'student', content: 'What is pressure?' }];
    }
    if (sql.includes('SELECT board FROM institutes')) return [{ board: 'CBSE' }];
    if (sql.includes('SELECT media FROM school_ai_tutor_messages')) {
      return overrides.quizRows ?? [{ media: { quiz: { questions: [{ answerIndex: 1 }, { answerIndex: 2 }] } } }];
    }
    if (sql.includes('FROM subjects sub')) return overrides.subjects ?? [{ id: 'sub-sci', name: 'Science' }];
    if (sql.includes('FROM textbook_chunks tc')) return [{ content: 'Pressure is force per unit area.', page_no: 3 }];
    if (sql.includes('INSERT INTO school_ai_tutor_messages') && sql.includes("'student'")) {
      return [{ id: 'm1', role: 'student', content: params[1], sources: [], created_at: 't1' }];
    }
    if (sql.includes('INSERT INTO school_ai_tutor_messages')) {
      return [{ id: 'm2', role: 'tutor', content: params[1], sources: JSON.parse(params[2]),
        media: JSON.parse(params[3]), syllabus_status: params[4], used_web: params[5], created_at: 't2' }];
    }
    return [];
  };
  const ds: any = { query: jest.fn(answer), transaction: jest.fn(async (fn: any) => fn({ query: answer })) };
  return { ds, calls };
}

function makeService(dsOverrides = {}, bridgeResult: any = {
  answer: 'Pressure is force per unit area [C1].', syllabusStatus: 'in_syllabus', usedWeb: false,
  courseMatched: true, sources: [{ id: 'C1', kind: 'course', title: 'Force and Pressure', label: 'p.3' }],
  wantMedia: true, mediaQuery: 'Why does a knife cut?',
}) {
  const { ds, calls } = makeDs(dsOverrides);
  const bridge: any = {
    aiTutorChat: jest.fn().mockResolvedValue(bridgeResult),
    aiTutorMedia: jest.fn().mockResolvedValue({
      images: [{ title: 'Knife diagram', imageUrl: 'https://a/i.png', thumbnailUrl: 'https://a/t.png', source: 'a', pageUrl: 'https://a' }],
      videos: [{ title: 'Pressure', url: 'https://www.youtube.com/watch?v=b5mtu1oqqjI', videoId: 'b5mtu1oqqjI',
        thumbnailUrl: 'https://i.ytimg.com/vi/b5mtu1oqqjI/hqdefault.jpg', channel: 'Magnet Brains', duration: '3:36' }],
    }),
  };
  const textbooks: any = {
    getGroundingPassages: jest.fn().mockResolvedValue({
      passages: [{ content: 'Pressure is force per unit area.', page_no: 3, source: 'ebook' }],
      ebookAvailable: true, lectureAvailable: false,
    }),
  };
  const config: any = { get: jest.fn((key: string) => (key === 'AI_TUTOR_DAILY_MESSAGE_LIMIT' ? '5' : undefined)) };
  const service = new SchoolAiTutorService(ds, bridge, textbooks, config);
  return { service, ds, calls, bridge, textbooks };
}

describe('SchoolAiTutorService', () => {
  describe('sendMessage', () => {
    it('answers from chapter passages and saves both messages', async () => {
      const { service, bridge, textbooks, calls } = makeService();
      const res = await service.sendMessage(USER, 'conv-1', { message: '  Why does a knife cut? ' });

      expect(textbooks.getGroundingPassages).toHaveBeenCalledWith(
        'inst-1', { chapterId: 'chap-fp', topicId: null }, 'both',
      );
      const [payload, tenantId, board] = bridge.aiTutorChat.mock.calls[0];
      expect(tenantId).toBe('inst-1');
      expect(board).toBe('cbse');
      expect(payload.message).toBe('Why does a knife cut?');
      expect(payload.student).toMatchObject({ className: 'Class 8', subjectName: 'Science', chapterName: 'Force and Pressure' });
      // History goes oldest first.
      expect(payload.history.map((h: any) => h.role)).toEqual(['student', 'tutor']);
      expect(payload.passages[0].chapter_name).toBe('Force and Pressure');
      expect(payload.allowWeb).toBe(true);

      expect(res.studentMessage.content).toBe('Why does a knife cut?');
      expect(res.tutorMessage).toMatchObject({ role: 'tutor', syllabusStatus: 'in_syllabus', usedWeb: false });
      expect(res.tutorMessage.sources[0].id).toBe('C1');
      expect(calls.some((c) => c.sql.includes('UPDATE school_ai_tutor_conversations'))).toBe(true);
    });

    it('is blocked while the student has a test in progress', async () => {
      const { service, bridge } = makeService({ testInProgress: true });
      await expect(service.sendMessage(USER, 'conv-1', { message: 'help' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(bridge.aiTutorChat).not.toHaveBeenCalled();
    });

    it('enforces the daily message limit', async () => {
      const { service, bridge } = makeService({ sentToday: 5 });
      const err = await service.sendMessage(USER, 'conv-1', { message: 'help' }).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(bridge.aiTutorChat).not.toHaveBeenCalled();
    });

    it('keyword-searches the subject textbook when the chat has no chapter', async () => {
      const { service, calls, textbooks, bridge } = makeService({ conv: { ...CONV, chapter_id: null, chapter_name: null } });
      await service.sendMessage(USER, 'conv-1', { message: 'What is atmospheric pressure?' });
      expect(textbooks.getGroundingPassages).not.toHaveBeenCalled();
      const search = calls.find((c) => c.sql.includes('FROM textbook_chunks tc'))!;
      expect(search.params).toEqual(['inst-1', ['sub-sci'], 'atmospheric | pressure']);
      expect(bridge.aiTutorChat.mock.calls[0][0].passages[0].source).toBe('ebook');
    });

    it('does not save anything when the AI call fails', async () => {
      const { service, ds, bridge } = makeService();
      bridge.aiTutorChat.mockRejectedValue(new Error('django down'));
      await expect(service.sendMessage(USER, 'conv-1', { message: 'help' }))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(ds.transaction).not.toHaveBeenCalled();
    });

    it('marks media as pending so the app loads it after the answer', async () => {
      const { service, bridge, calls } = makeService();
      const res = await service.sendMessage(USER, 'conv-1', { message: 'pressure' });
      expect(res.tutorMessage.mediaPending).toBe(true);
      expect(res.tutorMessage.images).toEqual([]);
      expect(res.studentMessage.mediaPending).toBe(false);
      expect(bridge.aiTutorMedia).not.toHaveBeenCalled();
      const insert = calls.find((c) => c.sql.includes("VALUES ($1, 'tutor'"))!;
      expect(JSON.parse(insert.params[3]).mediaQuery).toBe('Why does a knife cut?');
    });

    it('turns all Google searches off with AI_TUTOR_WEB_SEARCH=false', async () => {
      const { service, bridge } = makeService();
      (service as any).config.get = (key: string) => (key === 'AI_TUTOR_WEB_SEARCH' ? 'false' : undefined);
      await service.sendMessage(USER, 'conv-1', { message: 'pressure' });
      expect(bridge.aiTutorChat.mock.calls[0][0].allowWeb).toBe(false);
    });

    it('passes quiz mode through and stores the quiz with the reply', async () => {
      const quiz = { questions: [{ question: 'Q1', options: ['a', 'b', 'c', 'd'], answerIndex: 1, explanation: 'e' }] };
      const { service, bridge } = makeService({}, {
        answer: 'Quiz time!', mode: 'quiz', syllabusStatus: 'in_syllabus', usedWeb: false,
        courseMatched: true, sources: [], images: [], videos: [], quiz,
      });
      const res = await service.sendMessage(USER, 'conv-1', { message: 'Quiz me', mode: 'quiz' });
      expect(bridge.aiTutorChat.mock.calls[0][0].mode).toBe('quiz');
      expect(res.tutorMessage.quiz).toEqual(quiz);
      expect(res.tutorMessage.quizResult).toBeNull();
    });
  });

  describe('loadMedia', () => {
    const pending = [{ media: { mediaPending: true, mediaQuery: 'knife pressure', images: [], videos: [] } }];

    it('fetches, stores and returns media once', async () => {
      const { service, bridge, calls } = makeService({ quizRows: pending });
      const res = await service.loadMedia(USER, 'conv-1', 'msg-1');
      expect(bridge.aiTutorMedia).toHaveBeenCalledWith(
        { query: 'knife pressure', student: expect.objectContaining({ className: 'Class 8', chapterName: 'Force and Pressure' }) },
        'inst-1',
      );
      expect(res.images[0].title).toBe('Knife diagram');
      const update = calls.find((c) => c.sql.includes("COALESCE(media, '{}'::jsonb) ||"))!;
      expect(JSON.parse(update.params[1])).toMatchObject({ mediaPending: false });
    });

    it('returns stored media without calling the AI again', async () => {
      const { service, bridge } = makeService({ quizRows: [{ media: { images: [{ title: 'x' }], videos: [] } }] });
      const res = await service.loadMedia(USER, 'conv-1', 'msg-1');
      expect(bridge.aiTutorMedia).not.toHaveBeenCalled();
      expect(res.images).toEqual([{ title: 'x' }]);
    });

    it('stores an empty result when the AI call fails, so it is not retried forever', async () => {
      const { service, bridge, calls } = makeService({ quizRows: pending });
      bridge.aiTutorMedia.mockRejectedValue(new Error('down'));
      const res = await service.loadMedia(USER, 'conv-1', 'msg-1');
      expect(res).toEqual({ images: [], videos: [] });
      expect(calls.some((c) => c.sql.includes("COALESCE(media, '{}'::jsonb) ||"))).toBe(true);
    });
  });

  describe('saveQuizResult', () => {
    it('scores the answers against the stored quiz', async () => {
      const { service, calls } = makeService();
      const { quizResult } = await service.saveQuizResult(USER, 'conv-1', 'msg-1', [1, 0]);
      expect(quizResult).toMatchObject({ answers: [1, 0], score: 1, total: 2 });
      const update = calls.find((c) => c.sql.includes('jsonb_set'))!;
      expect(JSON.parse(update.params[1]).score).toBe(1);
    });

    it('rejects the wrong number of answers', async () => {
      const { service } = makeService();
      await expect(service.saveQuizResult(USER, 'conv-1', 'msg-1', [1]))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when the message has no quiz', async () => {
      const { service } = makeService({ quizRows: [{ media: {} }] });
      await expect(service.saveQuizResult(USER, 'conv-1', 'msg-1', [1]))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createConversation', () => {
    it('rejects a subject outside the student class', async () => {
      const { service } = makeService({ subjects: [{ id: 'sub-sci', name: 'Science' }] });
      await expect(service.createConversation(USER, { subjectId: 'sub-other' }))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('searchTerms', () => {
    it('keeps meaningful, tsquery-safe words only', () => {
      expect(SchoolAiTutorService.searchTerms("What's the pressure (P) in a fluid? Explain!"))
        .toEqual(['pressure', 'fluid']);
      expect(SchoolAiTutorService.searchTerms('a | b & !c')).toEqual([]);
    });
  });
});
