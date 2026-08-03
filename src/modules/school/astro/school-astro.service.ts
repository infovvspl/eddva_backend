import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  ACADEMIC_SUBJECTS, BREAK_PATTERNS, CAREERS, DAILY_DURATIONS, DEMO_DISCLAIMER,
  GROWTH_AREAS, LEARNING_TRAITS, PERSONALITY_TRAITS, QUOTES, REVISION_ADVICE,
  STRENGTHS, STUDY_SESSIONS, SUMMARY_CLOSERS, SUMMARY_OPENERS, TIMELINE_STAGES,
  WEEKLY_GOALS, type CareerDef, type TraitDef,
} from './astro.datasets';

/**
 * AI Astro Profile (Demo) — deterministic illustrative report.
 *
 * There is no model call and no randomness here. The same student details always
 * produce byte-identical output, which is what makes it safe to demo: a report
 * can be shown, closed, reopened and regenerated on another machine without the
 * numbers moving. Different details produce a clearly different report.
 *
 * The seed is SHA-256 over the normalised inputs; every choice below is an index
 * into that digest. Because the digest is walked with a moving cursor rather than
 * re-hashed per field, adding a new section changes only the sections after it —
 * so the report is stable for a given input but the content pools can still grow.
 *
 * This is explicitly a demonstration feature. Nothing here is measured, inferred
 * from student data, or predictive, and every response carries the disclaimer.
 */

export interface AstroInput {
  fullName: string;
  dateOfBirth: string;      // YYYY-MM-DD
  timeOfBirth?: string;     // HH:mm, optional
  placeOfBirth: string;
  gender?: string;          // optional, never used to alter scores
}

export interface ScoredTrait {
  key: string;
  label: string;
  score: number;
  blurb: string;
}

export interface ScoredCareer {
  key: string;
  label: string;
  match: number;
  rationale: string;
}

@Injectable()
export class SchoolAstroService {
  /**
   * A deterministic cursor over the SHA-256 digest.
   *
   * Kept as a closure rather than a class so a request can never accidentally
   * share state with another one — each generate() call gets its own stream.
   */
  private seedStream(seed: string) {
    // 32 bytes of digest, walked as an endless stream. When the cursor passes the
    // end it re-hashes rather than wrapping, so long reports do not repeat a
    // 32-byte cycle and end up with visibly correlated sections.
    let digest = createHash('sha256').update(seed).digest();
    let i = 0;

    const nextByte = (): number => {
      if (i >= digest.length) {
        digest = createHash('sha256').update(digest).digest();
        i = 0;
      }
      return digest[i++];
    };

    return {
      /** Integer in [min, max], inclusive, spread evenly across two bytes. */
      int(min: number, max: number): number {
        const span = max - min + 1;
        const v = (nextByte() << 8) | nextByte();
        return min + (v % span);
      },
      /** One item from a list. */
      pick<T>(list: T[]): T {
        return list[this.int(0, list.length - 1)];
      },
      /**
       * A stable shuffle. Fisher-Yates driven by the same stream, so the order
       * is reproducible for a seed but unrelated to the order in the dataset
       * file — adding an entry does not push everything down by one.
       */
      shuffle<T>(list: T[]): T[] {
        const out = [...list];
        for (let n = out.length - 1; n > 0; n--) {
          const j = this.int(0, n);
          [out[n], out[j]] = [out[j], out[n]];
        }
        return out;
      },
    };
  }

  /**
   * Normalise before hashing so trivial differences do not produce a different
   * report. "  Riya  Sharma " and "riya sharma" are the same student.
   */
  private normalise(v: string | undefined | null): string {
    return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private validate(input: AstroInput): AstroInput {
    const fullName = String(input?.fullName ?? '').trim();
    const placeOfBirth = String(input?.placeOfBirth ?? '').trim();
    const dateOfBirth = String(input?.dateOfBirth ?? '').trim();

    if (fullName.length < 2) {
      throw new BadRequestException('Please enter the full name');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      throw new BadRequestException('Date of birth must be in YYYY-MM-DD format');
    }
    const dob = new Date(`${dateOfBirth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestException('Date of birth is not a valid date');
    }
    if (dob.getTime() > Date.now()) {
      throw new BadRequestException('Date of birth cannot be in the future');
    }
    if (placeOfBirth.length < 2) {
      throw new BadRequestException('Please enter the place of birth');
    }
    const timeOfBirth = String(input?.timeOfBirth ?? '').trim();
    if (timeOfBirth && !/^\d{2}:\d{2}$/.test(timeOfBirth)) {
      throw new BadRequestException('Time of birth must be in HH:mm format');
    }

    return {
      fullName, dateOfBirth, placeOfBirth,
      timeOfBirth: timeOfBirth || undefined,
      gender: String(input?.gender ?? '').trim() || undefined,
    };
  }

  /** Scores a list of traits, highest first, within a deliberately positive band. */
  private scoreTraits(
    rng: ReturnType<SchoolAstroService['seedStream']>,
    defs: TraitDef[],
    min: number,
    max: number,
    take?: number,
  ): ScoredTrait[] {
    const chosen = take ? rng.shuffle(defs).slice(0, take) : defs;
    return chosen
      .map((d) => ({ key: d.key, label: d.label, score: rng.int(min, max), blurb: d.blurb }))
      .sort((a, b) => b.score - a.score);
  }

  generate(input: AstroInput) {
    const clean = this.validate(input);

    // Gender is deliberately excluded from the seed. It is collected because the
    // brief asks for it, but letting it change the report would mean two students
    // with identical details getting different "potential" — not defensible even
    // in a demo.
    const seed = [
      this.normalise(clean.fullName),
      this.normalise(clean.dateOfBirth),
      this.normalise(clean.placeOfBirth),
      this.normalise(clean.timeOfBirth),
    ].join('|');

    const seedHash = createHash('sha256').update(seed).digest('hex');
    const rng = this.seedStream(seed);

    const personality = this.scoreTraits(rng, PERSONALITY_TRAITS, 62, 96);
    const learning    = this.scoreTraits(rng, LEARNING_TRAITS, 58, 95);
    const academics   = this.scoreTraits(rng, ACADEMIC_SUBJECTS, 60, 96);

    const careers: ScoredCareer[] = rng
      .shuffle(CAREERS)
      .slice(0, 6)
      .map((c: CareerDef) => ({
        key: c.key, label: c.label, match: rng.int(64, 97), rationale: c.rationale,
      }))
      .sort((a, b) => b.match - a.match);

    const strengths   = this.scoreTraits(rng, STRENGTHS, 70, 97, 5);
    const growthAreas = this.scoreTraits(rng, GROWTH_AREAS, 48, 72, 4);

    const timeline = TIMELINE_STAGES.map((s) => ({
      key: s.key, label: s.label, note: rng.pick(s.lines),
    }));

    const suggestions = {
      bestSession:   rng.pick(STUDY_SESSIONS),
      dailyDuration: rng.pick(DAILY_DURATIONS),
      breakPattern:  rng.pick(BREAK_PATTERNS),
      revision:      rng.pick(REVISION_ADVICE),
      weeklyGoal:    rng.pick(WEEKLY_GOALS),
      quote:         rng.pick(QUOTES),
    };

    // The headline number is derived from the sections rather than rolled
    // separately, so it can never contradict the detail below it.
    const insightScore = Math.round(
      (personality.reduce((s, t) => s + t.score, 0) / personality.length) * 0.4 +
      (learning.reduce((s, t) => s + t.score, 0) / learning.length) * 0.3 +
      (academics.reduce((s, t) => s + t.score, 0) / academics.length) * 0.3,
    );

    const summary = this.buildSummary(
      rng, clean.fullName, personality, learning, academics, careers, strengths, growthAreas,
    );

    return {
      demo: true,
      disclaimer: DEMO_DISCLAIMER,
      overview: {
        fullName: clean.fullName,
        dateOfBirth: clean.dateOfBirth,
        timeOfBirth: clean.timeOfBirth ?? null,
        placeOfBirth: clean.placeOfBirth,
        gender: clean.gender ?? null,
        generatedOn: new Date().toISOString(),
        insightScore,
        // Exposed so two people can confirm they are looking at the same report.
        profileId: seedHash.slice(0, 12),
      },
      personality,
      learning,
      academics,
      careers,
      strengths,
      growthAreas,
      timeline,
      suggestions,
      summary,
    };
  }

  /** A short written report. Possibility language only — never prediction. */
  private buildSummary(
    rng: ReturnType<SchoolAstroService['seedStream']>,
    name: string,
    personality: ScoredTrait[],
    learning: ScoredTrait[],
    academics: ScoredTrait[],
    careers: ScoredCareer[],
    strengths: ScoredTrait[],
    growthAreas: ScoredTrait[],
  ): string {
    const firstName = name.split(' ')[0];
    const topTraits = personality.slice(0, 2).map((t) => t.label.toLowerCase());
    const topLearning = learning[0].label.toLowerCase().replace(' learner', '');
    const topSubjects = academics.slice(0, 2).map((s) => s.label);
    const topCareers = careers.slice(0, 2).map((c) => c.label);
    const topStrength = strengths[0].label.toLowerCase();
    const growth = growthAreas[0].label.toLowerCase();

    return [
      `${rng.pick(SUMMARY_OPENERS)} leans on ${topTraits[0]} and ${topTraits[1]}. ` +
      `${firstName} may take in new material most comfortably through a ${topLearning} approach, ` +
      `which tends to suit students who like to see how an idea holds together before memorising it.`,

      `Academically, this profile points toward ${topSubjects[0]} and ${topSubjects[1]}. ` +
      `That does not rule anything out — it simply suggests where the work may feel most natural at first.`,

      `On career direction, ${topCareers[0]} and ${topCareers[1]} appear to fit the pattern here. ` +
      `These are starting points for conversation rather than recommendations; interests at this age ` +
      `change often, and that is healthy.`,

      `The clearest strength showing through is ${topStrength}. ` +
      `The most useful area to develop is ${growth} — not a weakness, but the place where a small ` +
      `amount of attention could make the biggest difference.`,

      rng.pick(SUMMARY_CLOSERS),
    ].join('\n\n');
  }
}
