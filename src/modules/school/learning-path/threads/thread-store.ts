import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { initialStepStatus, STEP_KINDS, StepKind } from './thread-path';

export type MessageRole = 'student' | 'ai' | 'system';

export interface NewMessage {
  role: MessageRole;
  kind: string;
  content: Record<string, unknown>;
  stepId?: string | null;
  round?: number | null;
}

const PAGE_SIZE = 30;

/** SQL for threads, steps and messages. Every read that takes an id from the client also takes the student id. */
@Injectable()
export class ThreadStore {
  constructor(@InjectDataSource('school') private readonly ds: DataSource) {}

  get manager(): EntityManager {
    return this.ds.manager;
  }

  transaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.ds.transaction(fn);
  }

  async loadOwnedThread(manager: EntityManager, studentId: string, threadId: string, lock = false) {
    const rows = await manager.query(
      `SELECT * FROM learning_threads WHERE id::text = $1::text AND student_id::text = $2::text${lock ? ' FOR UPDATE' : ''}`,
      [threadId, studentId],
    );
    if (!rows.length) throw new NotFoundException('Chat not found');
    return rows[0];
  }

  async loadStep(manager: EntityManager, threadId: string, stepId: string, lock = false) {
    const rows = await manager.query(
      `SELECT * FROM learning_thread_steps WHERE id::text = $1::text AND thread_id::text = $2::text${lock ? ' FOR UPDATE' : ''}`,
      [stepId, threadId],
    );
    if (!rows.length) throw new NotFoundException('Step not found');
    return rows[0];
  }

  /** A quiz/assessment step's accuracy comes along once it is graded, so the path can mark a failed attempt. */
  async steps(manager: EntityManager, threadId: string) {
    return manager.query(
      `SELECT ts.*, qi.accuracy AS quiz_accuracy
         FROM learning_thread_steps ts
         LEFT JOIN learning_quiz_instances qi
           ON qi.id = ts.ref_id AND qi.status IN ('submitted', 'auto_submitted')
        WHERE ts.thread_id = $1
        ORDER BY ts.round, ts.ordinal`,
      [threadId],
    );
  }

  async roundStep(manager: EntityManager, threadId: string, round: number, kind: StepKind) {
    const rows = await manager.query(
      `SELECT * FROM learning_thread_steps WHERE thread_id = $1 AND round = $2 AND kind = $3`,
      [threadId, round, kind],
    );
    return rows[0] ?? null;
  }

  /** The four steps of a round; returns the videos step, where the round starts. */
  async createRound(manager: EntityManager, threadId: string, round: number, focus: string[]) {
    const rows = [];
    for (const [i, kind] of STEP_KINDS.entries()) {
      const [row] = await manager.query(
        `INSERT INTO learning_thread_steps (thread_id, round, ordinal, kind, status, focus_concepts)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (thread_id, round, kind) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [threadId, round, i + 1, kind, initialStepStatus(kind), JSON.stringify(focus)],
      );
      rows.push(row);
    }
    return rows[0];
  }

  async setStepStatus(manager: EntityManager, stepId: string, status: string) {
    await manager.query(
      `UPDATE learning_thread_steps
          SET status = $2::varchar, updated_at = NOW(),
              completed_at = CASE WHEN $2::varchar = 'done' THEN COALESCE(completed_at, NOW()) ELSE completed_at END
        WHERE id = $1`,
      [stepId, status],
    );
  }

  async addMessages(manager: EntityManager, threadId: string, messages: NewMessage[]) {
    const out = [];
    for (const m of messages) {
      const [row] = await manager.query(
        `INSERT INTO learning_thread_messages (thread_id, step_id, round, role, kind, content_json)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [threadId, m.stepId ?? null, m.round ?? null, m.role, m.kind, JSON.stringify(m.content)],
      );
      out.push(row);
    }
    await manager.query(
      `UPDATE learning_threads SET message_count = message_count + $2, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [threadId, messages.length],
    );
    return out.map(toMessageView);
  }

  /** Newest page first in the query, returned oldest-first for display. `before` is the cursor from the previous page. */
  async messagesPage(threadId: string, before?: string) {
    const cursor = before ? decodeCursor(before) : null;
    const rows = await this.ds.query(
      `SELECT * FROM learning_thread_messages
        WHERE thread_id = $1 ${cursor ? 'AND (created_at, id) < ($2::timestamptz, $3::uuid)' : ''}
        ORDER BY created_at DESC, id DESC
        LIMIT ${PAGE_SIZE + 1}`,
      cursor ? [threadId, cursor.createdAt, cursor.id] : [threadId],
    );
    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      messages: page.reverse().map(toMessageView),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }
}

export function toMessageView(row: any) {
  return {
    id: row.id,
    role: row.role as MessageRole,
    kind: row.kind as string,
    stepId: row.step_id ?? null,
    round: row.round ?? null,
    content: row.content_json ?? {},
    createdAt: row.created_at,
  };
}

export function encodeCursor(createdAt: Date | string, id: string): string {
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(String(cursor), 'base64url').toString('utf8').split('|');
  const validDate = createdAt && !Number.isNaN(Date.parse(createdAt));
  const validId = /^[0-9a-f-]{36}$/i.test(id ?? '');
  if (!validDate || !validId) throw new BadRequestException('Invalid cursor');
  return { createdAt, id };
}
