# EDDVA / APEXIQ — Backend

One NestJS application serving **two products** from a single deployment:

- **School** (EDDVA) — institutes, classes, sections, timetables, attendance,
  fees, assessments, homework, live classes, report cards, parent access.
- **Coaching** (APEXIQ) — JEE/NEET batches, PYQs, the Battle Arena, study
  plans, mock tests.

They share the process, the HTTP server and most infrastructure, but they are
**separate databases with separate authentication**. Understanding that split
is the first thing a newcomer needs, so it is explained in full below.

---

## Quick start

```sh
npm install
cp .env.example .env         # then fill in DB, Redis and JWT values
npm run start:dev            # http://localhost:3000
```

| | |
| --- | --- |
| API base path | `/api/v1` (override with `API_PREFIX`) |
| Port | `3000` (override with `PORT`) |
| Swagger UI | `http://localhost:3000/docs` |

`start:dev` kills anything already on port 3000 before starting, so a stale
process from a previous run will not block you.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Development server via ts-node |
| `npm run start:debug` | Watch mode with the Node inspector attached |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run the compiled build |
| `npm test` | Jest test suite |
| `npm run test:watch` / `test:cov` | Watch mode / coverage |
| `npm run lint` | ESLint with `--fix` |
| `npm run format` | Prettier over `src/` |
| `npm run seed` | Seed baseline data |
| `npm run seed:super-admins` | Create the platform super-admin accounts |

Type checking has no dedicated script — run `npx tsc --noEmit`.

## The two-database architecture

This is the single most important thing to know about this codebase.

The application registers **two TypeORM datasources**:

| Datasource | Connection string | Used by |
| --- | --- | --- |
| default (unnamed) | `DB_URL` / `COACHING_DB_URL` | coaching product |
| `'school'` | `SCHOOL_DB_URL` | everything under `src/modules/school` |

School services inject the named connection:

```ts
constructor(@InjectDataSource('school') private readonly ds: DataSource) {}
```

Forgetting the `'school'` name silently gives you the coaching database, where
the tables you want do not exist. If a school query fails with *relation does
not exist*, check this first.

### Schema management differs per side

**The `src/migrations/` folder is empty, and that is deliberate.** The school
module does not use TypeORM migrations. Instead, each service creates and
evolves its own tables at runtime with idempotent SQL:

```ts
await this.ds.query(`CREATE TABLE IF NOT EXISTS … `);
await this.ds.query(`ALTER TABLE … ADD COLUMN IF NOT EXISTS … `);
```

These live in `ensureSchema()`-style methods called at the start of a request
(guarded by a `schemaReady` flag so they run once per process). Roughly 28
school files follow this pattern. When adding a column to a school table, add
an idempotent `ADD COLUMN IF NOT EXISTS` to the relevant `ensure…()` method —
do not introduce a migration framework for the school side without discussing
it first.

The coaching side retains the TypeORM migration scripts (`migration:generate`,
`migration:run`, `migration:revert`). Note that the migration chain is known to
be broken partway; creating tables directly has been the working practice.

## Authentication

The two products have **entirely separate auth stacks**. They are not
interchangeable, and a token from one is meaningless to the other.

| | Coaching | School |
| --- | --- | --- |
| Module | `src/modules/auth` | `src/modules/school-auth`, `src/modules/school/auth` |
| Guard | `JwtAuthGuard` | `SchoolJwtGuard` |
| Roles | `RolesGuard` | `SchoolRolesGuard` + `@SchoolRoles(...)` |
| Tenancy | tenant, by subdomain | `institute_id`, from the user record |

School requests additionally pass through **`SchoolFeatureGuard`**, which
enforces per-institute module and AI-feature switches declared with
`@SchoolFeature('module', 'assessments')` or `@SchoolFeature('ai', 'ai_doubt_solver')`.

`SchoolJwtGuard` loads the user from the database on each request (with a short
cache) and attaches the institute's flags — `inst_ai_enabled`,
`inst_ai_features`, `inst_modules_permissions` — onto `req.user`. Services that
need an inline check use `isSchoolAiFeatureEnabled(user, key)` from
`src/modules/school/common/ai-features.registry.ts`, which resolves exactly as
the guard does so the two cannot drift apart.

School roles: `SUPER_ADMIN`, `INSTITUTE_ADMIN`, `TEACHER`, `STUDENT`, `PARENT`.

## Module layout

`src/modules/` holds 40 top-level modules. The largest by far is `school/`,
with roughly 50 submodules of its own:

```text
src/modules/
  school/            the school product
    assessment/      question papers, attempts, grading, the diagram engine
    textbook/        chapter ingestion, figure extraction, RAG grounding
    live/            RTMP → HLS classes with Socket.IO interaction
    attendance/ fee/ timetable/ report/ staff/ student/ parent/ …
    guards/ decorators/ common/     cross-cutting school concerns
  auth/ student/ batch/ battle/ pyq/ study-plan/    coaching
  ai-bridge/         outbound calls to the Django AI service
  ai-usage/          per-tenant AI usage accounting
  upload/            R2 / S3 storage (S3Service)
  notification/ mail/ otp/ chat/ presence/          shared services
  internal/          service-to-service endpoints (INTERNAL_API_KEY)
```

## The AI service

Anything generative — question papers, doubt answers, notes, PPT decks,
textbook grounding, subjective grading — is produced by a **separate Django
service** (`eddva_ai_service`), not by this repository. This backend reaches it
through `src/modules/ai-bridge`.

Calls carry a service-account API key plus an `X-Tenant-ID` header holding the
school's institute UUID, which is how the AI service attributes usage and
applies that institute's token budget. The AI service calls back into
`src/modules/internal` to report usage, authenticated with `INTERNAL_API_KEY`.

Relevant configuration: `AI_BASE_URL`, `AI_API_KEY`, `AI_TIMEOUT_MS`, and the
`AI_ADMISSION_*` family that bounds concurrent AI work per tenant.

Not everything labelled "AI" costs a model call. The assessment **diagram
engine** (`src/modules/school/assessment/diagram/`) renders SVG deterministically
from validated specifications with no network call at all, and textbook figure
extraction crops images straight out of the chapter PDF.

## Real-time

Socket.IO gateways serve the Battle Arena, chat, presence and school live
classes (namespace `/school-live`). Redis backs sessions, caching and the
BullMQ queues used for background work such as media processing.

## Storage and media

Uploads go to Cloudflare R2 (S3-compatible) through `S3Service` in
`src/modules/upload`. `R2_ACCOUNT_ID` must be set — leaving it undefined breaks
every server-to-R2 TLS connection. Recordings are remuxed with ffmpeg
(`@ffmpeg-installer/ffmpeg`) and served from the CDN at `LIVE_CDN_BASE_URL`.

## Environment variables

`.env.example` is the authoritative list. The ones you cannot start without:

| Variable | Purpose |
| --- | --- |
| `DB_URL` / `COACHING_DB_URL` | Coaching PostgreSQL |
| `SCHOOL_DB_URL` | School PostgreSQL |
| `REDIS_URL` | Cache, sessions, queues |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Token signing |
| `CORS_ORIGINS` | Comma-separated allowed origins |

Commonly needed beyond that: `AI_BASE_URL` and `AI_API_KEY` (AI features),
`INTERNAL_API_KEY` (usage callbacks), `AWS_*` / `CLOUDFLARE_ACCOUNT_ID` /
`R2_ACCOUNT_ID` (storage), `MAIL_*` (email), Twilio credentials (SMS/OTP),
`FRONTEND_URL`, and `DB_POOL_MAX` / `SCHOOL_DB_POOL_MAX` for pool sizing.

`DB_SYNC` must stay **false** outside local experimentation — TypeORM
synchronisation against these databases will drop data.

## Testing

Jest, with specs beside the code as `*.spec.ts` and `rootDir` set to `src`.

```sh
npm test
npx jest src/modules/school/assessment      # one area
```

Two notes on the current state: `src/modules/chat/chat.service.spec.ts` has
11 failing tests from a missing provider in its testing module — a known,
pre-existing failure unrelated to feature work. And `tsc --noEmit` does **not**
type-check `.spec.ts` files, so a spec can compile-fail only under Jest.

## Deployment

| Branch | Workflow | Target |
| --- | --- | --- |
| `dev` | `.github/workflows/deploy-dev.yml` | DEV |
| `main` | `.github/workflows/deploy.yml` | Production |

Both install from `requirements`/`package.json` on the server and restart via
pm2. Because the school side builds its schema at runtime, a deploy needs no
migration step — new columns appear on the first request that touches them.

## Repository notes

The root previously accumulated several hundred one-off debugging scripts;
these were cleared. What remains beside the config files are genuine tools —
the seed scripts, `run_school_migrations.ts`, `list-routes`, and the
`add-*` / `create-*` / `drop-*` schema helpers. Those helpers apply ad-hoc DDL
outside any migration system; prefer the `ensureSchema()` convention for new
work.
