import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../../ai-bridge/ai-bridge.service';
import { StudentIdentity, TopicContext } from '../common/student-curriculum.repository';

export interface StepVideo {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnailUrl: string;
}

const CACHE_DAYS = 30;
/** The videos step shows one video: the best for the topic, the class and the board. */
const MAX_VIDEOS = 1;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** Bumped when the way the video is chosen changes, so older picks are not reused. */
const CACHE_VERSION = 'best1';

/** Keep only real YouTube ids and plain-text metadata; the page builds the (youtube-nocookie) embed URL itself. */
export function sanitizeVideos(raw: unknown, max = MAX_VIDEOS): StepVideo[] {
  const seen = new Set<string>();
  const out: StepVideo[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const videoId = String((v as any)?.videoId ?? '').trim();
    if (!YOUTUBE_ID.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    const thumb = String((v as any)?.thumbnailUrl ?? '');
    out.push({
      videoId,
      title: String((v as any)?.title ?? '').slice(0, 200),
      channel: String((v as any)?.channel ?? '').slice(0, 100),
      duration: String((v as any)?.duration ?? '').slice(0, 20),
      thumbnailUrl: /^https:\/\/i\.ytimg\.com\//.test(thumb) ? thumb : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * `subtopicId`, when given, replaces `topicId` as the cache's own identity —
 * so each subtopic under a topic gets its own cached video instead of all of
 * them colliding on one topic-wide entry (they'd otherwise share both the
 * same topicId and, for a first-round search, the same empty `focus`).
 */
export function videoCacheKey(topicId: string, focus: string[], className: string | null = null, board = '', subtopicId: string | null = null): string {
  const f = [...new Set(focus.map((c) => c.trim().toLowerCase()).filter(Boolean))].sort().join('|');
  const who = `${(className ?? '').trim().toLowerCase()}/${board.trim().toLowerCase()}`;
  const scope = subtopicId ? `sub:${subtopicId}` : topicId;
  return `${CACHE_VERSION}:${scope}:${who}:${f}`.slice(0, 300);
}

/**
 * The one best YouTube video for a step: searched for the topic, its chapter,
 * the student's class and the school's board, and picked by the AI service.
 * Cached per institute, topic, class, board and focus, so search quota is spent
 * once per topic.
 */
@Injectable()
export class TopicVideosService {
  private readonly logger = new Logger(TopicVideosService.name);

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridge: AiBridgeService,
  ) {}

  async forStep(student: StudentIdentity, topic: TopicContext, focus: string[], subtopicId: string | null = null): Promise<StepVideo[]> {
    const instituteId = student.instituteId;
    const board = await this.board(instituteId);
    const key = videoCacheKey(topic.topicId, focus, student.className, board, subtopicId);
    if (instituteId) {
      const cached = await this.ds.query(
        `SELECT videos_json FROM topic_video_cache
          WHERE institute_id::text = $1::text AND cache_key = $2 AND fetched_at > NOW() - make_interval(days => $3)`,
        [instituteId, key, CACHE_DAYS],
      );
      if (cached.length) return sanitizeVideos(cached[0].videos_json);
    }

    const videos = await this.search(student, topic, focus, board);
    if (!videos) return []; // the search failed: not cached, so the next student tries again

    if (instituteId && videos.length) {
      await this.ds.query(
        `INSERT INTO topic_video_cache (institute_id, cache_key, topic_id, videos_json, fetched_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (institute_id, cache_key) DO UPDATE SET videos_json = EXCLUDED.videos_json, fetched_at = NOW()`,
        [instituteId, key, topic.topicId, JSON.stringify(videos)],
      );
    }
    return videos;
  }

  /** The best video, or null when the search failed. Falls back to the general media search if the dedicated one is unavailable. */
  private async search(student: StudentIdentity, topic: TopicContext, focus: string[], board: string): Promise<StepVideo[] | null> {
    const instituteId = student.instituteId ?? undefined;
    const topicText = [topic.topicName, ...focus.slice(0, 2)].filter(Boolean).join(' ');
    try {
      const res = await this.aiBridge.findTopicVideo(
        { topic: topicText, chapter: topic.chapterName, subject: topic.subjectName, className: student.className ?? undefined, board: board || undefined },
        instituteId,
      );
      return sanitizeVideos(res?.video ? [res.video] : []);
    } catch (err) {
      this.logger.warn(`Best-video search failed for topic ${topic.topicId}, trying the general search: ${(err as Error)?.message}`);
    }
    try {
      const query = [topicText, topic.subjectName, student.className ? `class ${student.className}` : '', board].filter(Boolean).join(' ');
      const media = await this.aiBridge.aiTutorMedia(
        {
          query,
          student: { className: student.className ?? undefined, subjectName: topic.subjectName, chapterName: topic.chapterName, topicName: topic.topicName },
        },
        instituteId,
      );
      return sanitizeVideos(media?.videos);
    } catch (err) {
      this.logger.warn(`Video search failed for topic ${topic.topicId}: ${(err as Error)?.message}`);
      return null;
    }
  }

  private async board(instituteId: string | null): Promise<string> {
    if (!instituteId) return '';
    const rows = await this.ds.query(`SELECT board FROM institutes WHERE id::text = $1::text`, [instituteId]).catch(() => []);
    return String(rows?.[0]?.board ?? '').trim();
  }
}
