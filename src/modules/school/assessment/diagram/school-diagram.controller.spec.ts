/**
 * Authorization on the diagram routes, exercised through real HTTP.
 *
 * Every other test in this feature constructs the service directly, which
 * means the guards — the things that actually stop the wrong person reaching a
 * diagram — were asserted only by reading decorators. This spec runs them.
 *
 * WHAT IS REAL HERE: the controller and its decorators, SchoolRolesGuard,
 * SchoolFeatureGuard, Nest's routing and exception mapping, the diagram
 * service, and SchoolAssessmentService.checkAssessmentAccess — the tenant
 * check that decides whether a teacher may touch this assessment at all.
 * Requests go over a real socket to a real listening Nest app.
 *
 * WHAT IS STUBBED: authentication only. SchoolJwtGuard verifies a signed token
 * and loads the user from the database; that is a different mechanism with its
 * own concerns, and reproducing it here would test jsonwebtoken rather than
 * this module's authorization. It is replaced by a guard that puts a chosen
 * user on the request — which is precisely the input the authorization guards
 * consume. Everything downstream of "who is calling" is genuine.
 *
 * No supertest in this repository, so requests are made with node:http. That
 * adds no dependency and is, if anything, closer to the wire.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import * as http from 'http';
import { SchoolDiagramController } from './school-diagram.controller';
import { SchoolDiagramService } from './school-diagram.service';
import { SchoolAssessmentService } from '../school-assessment.service';
import { S3Service } from '../../../upload/s3.service';
import { SchoolJwtGuard } from '../../guards/school-jwt.guard';

const ASSESSMENT = 'aa11bb22-0000-4000-8000-000000000001';
const INSTITUTE = 'e9f3592d-851a-43be-9361-574e57722703';
const OTHER_INSTITUTE = 'c259cd4e-b018-45e2-8e46-52a497ca49a1';
const CLASS = 'cc33dd44-0000-4000-8000-000000000003';

const SPEC = {
  kind: 'geometry',
  points: [{ id: 'O', x: 0, y: 0 }],
  shapes: [{ type: 'circle', center: 'O', radius: 5 }],
};

/** The user the stubbed authentication puts on the next request. */
let currentUser: any = null;

const TEACHER = {
  id: 'tea-0001', role: 'TEACHER', instituteId: INSTITUTE,
  inst_modules_permissions: { assessments: true },
};

const STUDENT = {
  id: 'stu-0001', role: 'STUDENT', instituteId: INSTITUTE,
  studentProfile: { class_id: CLASS },
  inst_modules_permissions: { assessments: true },
};

const FOREIGN_TEACHER = {
  id: 'tea-0002', role: 'TEACHER', instituteId: OTHER_INSTITUTE,
  inst_modules_permissions: { assessments: true },
};

const MODULE_DISABLED_TEACHER = {
  ...TEACHER, id: 'tea-0003',
  inst_modules_permissions: { assessments: false },
};

/** A datasource that answers what this flow asks, and nothing else. */
function makeDataSource() {
  const rows: any[] = [];
  return {
    rows,
    query: jest.fn(async (sql: string, params: any[] = []) => {
      if (/^\s*(ALTER TABLE|CREATE TABLE|CREATE (UNIQUE )?INDEX)/i.test(sql)) return [];
      if (/FROM assessments a\s+LEFT JOIN classes c/i.test(sql)) {
        return String(params[0]) === ASSESSMENT
          ? [{
            id: ASSESSMENT, institute_id: INSTITUTE, class_institute_id: INSTITUTE,
            class_id: CLASS, teacher_id: 'tea-0001',
          }]
          : [];
      }
      if (/FROM teachers WHERE user_id/i.test(sql)) return [{ id: 'tea-0001' }];
      if (/INSERT INTO assessment_diagrams/i.test(sql)) {
        rows.push({ marker_key: params[2] });
        return [];
      }
      if (/FROM assessment_diagrams/i.test(sql)) return [];
      return [];
    }),
  };
}

let app: INestApplication;
let ds: ReturnType<typeof makeDataSource>;

/** One request over a real socket. */
function request(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const address = app.getHttpServer().address();
  const port = typeof address === 'string' ? 0 : address.port;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': payload.length }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: any = text;
          try { parsed = text ? JSON.parse(text) : null; } catch { /* keep the text */ }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  ds = makeDataSource();
  const s3 = {
    upload: jest.fn(async (key: string) => `https://media.example/${key}`),
    toPublicUrl: jest.fn((key: string) => `https://media.example/${key}`),
  };

  // Built by hand rather than resolved: checkAssessmentAccess is the only part
  // of this service the diagram routes use, and it needs the datasource alone.
  const assessments = new SchoolAssessmentService(
    ds as any, {} as any, {} as any, {} as any, s3 as any, {} as any,
  );

  const moduleRef = await Test.createTestingModule({
    controllers: [SchoolDiagramController],
    providers: [
      SchoolDiagramService,
      { provide: SchoolAssessmentService, useValue: assessments },
      { provide: S3Service, useValue: s3 },
      { provide: getDataSourceToken('school'), useValue: ds },
    ],
  })
    // Authentication only. The roles and feature guards stay real.
    .overrideGuard(SchoolJwtGuard)
    .useValue({
      canActivate: (context: any) => {
        context.switchToHttp().getRequest().user = currentUser;
        return true;
      },
    })
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  currentUser = null;
  ds.rows.length = 0;
});

describe('who may reach the diagram routes', () => {
  it('1. a STUDENT is refused — authoring is staff work', async () => {
    currentUser = STUDENT;
    const res = await request('POST', `/school/assessments/${ASSESSMENT}/diagrams`, { spec: SPEC });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/not authorized/i);
    // Refused before anything was stored.
    expect(ds.rows).toHaveLength(0);
  });

  it('2. a student is refused on every route, not only create', async () => {
    currentUser = STUDENT;
    const listed = await request('GET', `/school/assessments/${ASSESSMENT}/diagrams`);
    const previewed = await request(
      'POST', `/school/assessments/${ASSESSMENT}/diagrams/preview`, { spec: SPEC },
    );
    const approved = await request(
      'POST', `/school/assessments/${ASSESSMENT}/diagrams/abcd1234/approval`, { approved: true },
    );

    expect(listed.status).toBe(403);
    expect(previewed.status).toBe(403);
    expect(approved.status).toBe(403);
  });

  it('3. a TEACHER from another institute is refused by the tenant check', async () => {
    currentUser = FOREIGN_TEACHER;
    const res = await request('POST', `/school/assessments/${ASSESSMENT}/diagrams`, { spec: SPEC });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/do not have access/i);
    expect(ds.rows).toHaveLength(0);
  });

  it('4. an institute with the assessments module disabled is refused', async () => {
    currentUser = MODULE_DISABLED_TEACHER;
    const res = await request('POST', `/school/assessments/${ASSESSMENT}/diagrams`, { spec: SPEC });

    expect(res.status).toBe(403);
    expect(res.body?.message?.code || res.body?.code).toBe('FEATURE_DISABLED');
    expect(ds.rows).toHaveLength(0);
  });

  it('5. the owning TEACHER is allowed, and the diagram is stored unapproved', async () => {
    currentUser = TEACHER;
    const res = await request('POST', `/school/assessments/${ASSESSMENT}/diagrams`, { spec: SPEC });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.markerKey).toMatch(/^[0-9a-f]{8}$/);
    expect(res.body.data.marker).toBe(`[DIAGRAM: ${res.body.data.markerKey}]`);
    // Creation never approves: that is a separate, recorded act.
    expect(res.body.data.approved).toBe(false);
    expect(ds.rows).toHaveLength(1);
  });

  it('6. an unauthenticated request is refused rather than treated as staff', async () => {
    currentUser = null;
    const res = await request('POST', `/school/assessments/${ASSESSMENT}/diagrams`, { spec: SPEC });
    expect(res.status).toBe(403);
    expect(ds.rows).toHaveLength(0);
  });

  it('7. an assessment that does not exist is 404, and stores nothing', async () => {
    currentUser = TEACHER;
    const missing = 'ffffffff-0000-4000-8000-000000000000';
    const res = await request('POST', `/school/assessments/${missing}/diagrams`, { spec: SPEC });

    expect(res.status).toBe(404);
    expect(ds.rows).toHaveLength(0);
  });

  it('8. an authorized teacher sending a bad spec gets 422, not 403', async () => {
    // The two failures must stay distinguishable: one is "you may not", the
    // other is "this drawing is wrong" and is a teacher's to fix.
    currentUser = TEACHER;
    const res = await request(
      'POST', `/school/assessments/${ASSESSMENT}/diagrams`,
      { spec: { kind: 'geometry', points: [], shapes: [{ type: 'chord', circle: 'O', from: 'A', to: 'B' }] } },
    );

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.stage).toBe('structural');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(ds.rows).toHaveLength(0);
  });

  it('9. a caller-supplied instituteId in the body changes nothing', async () => {
    // The tenant comes from the assessment row. A body field claiming another
    // institute must neither be honoured nor cause a different outcome.
    currentUser = FOREIGN_TEACHER;
    const res = await request(
      'POST', `/school/assessments/${ASSESSMENT}/diagrams`,
      { spec: SPEC, instituteId: OTHER_INSTITUTE, institute_id: OTHER_INSTITUTE },
    );

    expect(res.status).toBe(403);
    expect(ds.rows).toHaveLength(0);
  });
});
