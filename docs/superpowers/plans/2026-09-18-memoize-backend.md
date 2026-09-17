# Memoize Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Memoize REST API — a Node/Express/Prisma/Postgres backend covering auth, problem logging, revision list, streaks, topic progress, monthly goals, LeetCode sync, and email reminders — as a fully working, independently testable service (no UI required to verify it).

**Architecture:** Single Express app (`apps/api`) in an npm-workspaces monorepo, with a small shared types package (`packages/shared`) for the frontend to consume later. Postgres via Prisma. JWT-in-httpOnly-cookie auth. Two `node-cron` jobs run in-process: LeetCode sync (every 6h) and reminder emails (daily 8pm UTC).

**Tech Stack:** Node.js 18+, TypeScript (ESM/NodeNext), Express, Prisma + PostgreSQL, zod, bcryptjs, jsonwebtoken, node-cron, Resend, Vitest + Supertest.

**Spec:** `docs/superpowers/specs/2026-09-18-leetcode-tracker-design.md`

## Global Constraints

- Node.js 18+ (native global `fetch` required, no `node-fetch` dependency).
- TypeScript throughout, ESM (`"type": "module"`, `moduleResolution: "NodeNext"` — relative imports use explicit `.js` extensions).
- Auth: bcrypt-hashed passwords, JWT in an httpOnly cookie (30-day expiry). No third-party auth service.
- LeetCode sync runs every 6 hours per user with a `leetcodeUsername` set (cron `0 */6 * * *`); `POST /api/sync/me` exists to trigger it manually without waiting on the cron.
- Reminder emails send daily at 8pm UTC (cron `0 20 * * *`); no per-user timezone handling in v1.
- Revision is a manual boolean flag only — no spaced-repetition scheduling.
- Streak = at least 1 problem solved that calendar day (UTC), tracked via `DailyActivity`.
- All API input validated with `zod`; errors return `{ error: string }` JSON with an appropriate 4xx/5xx status.
- Topic progress and monthly-goal progress are computed on read (never stored).
- Tests run with Vitest + Supertest against a real local Postgres database — set `DATABASE_URL` in `apps/api/.env` before running `npm run test -w apps/api`. No mocking of Prisma itself.

---

### Task 1: Monorepo scaffolding + health check

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/.env.example`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/index.ts`
- Test: `apps/api/tests/health.test.ts`

**Interfaces:**
- Produces: `createApp(): Express` from `apps/api/src/app.ts` — every later task's tests import this to build a fresh app instance.

- [ ] **Step 1: Create the root workspace files**

`package.json`:
```json
{
  "name": "memoize",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:api": "npm run dev -w apps/api",
    "test:api": "npm run test -w apps/api",
    "build": "npm run build -w packages/shared && npm run build -w apps/api"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist"
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
.env.test
```

- [ ] **Step 2: Create the shared types package**

`packages/shared/package.json`:
```json
{
  "name": "@memoize/shared",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json" }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/shared/src/index.ts`:
```ts
export type Difficulty = 'easy' | 'medium' | 'hard';
export type ProblemStatus = 'not_started' | 'attempted' | 'solved';
export type ProblemSource = 'imported' | 'manual';

export interface TopicDTO {
  id: string;
  name: string;
  slug: string;
}

export interface ProblemDTO {
  id: string;
  leetcodeSlug: string | null;
  title: string;
  url: string;
  difficulty: Difficulty;
  topics: TopicDTO[];
}

export interface UserProblemDTO {
  id: string;
  status: ProblemStatus;
  needsRevision: boolean;
  notes: string | null;
  source: ProblemSource;
  firstSolvedAt: string | null;
  lastTouchedAt: string;
  problem: ProblemDTO;
}
```

- [ ] **Step 3: Scaffold the API package**

`apps/api/package.json`:
```json
{
  "name": "@memoize/api",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "express": "^4.19.2",
    "@prisma/client": "^5.19.0",
    "cookie-parser": "^1.4.6",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3",
    "zod": "^3.23.8",
    "node-cron": "^3.0.3",
    "resend": "^4.0.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "prisma": "^5.19.0",
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "supertest": "^7.0.0",
    "@types/express": "^4.17.21",
    "@types/cookie-parser": "^1.4.7",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/bcryptjs": "^2.4.6",
    "@types/supertest": "^6.0.2",
    "@types/node": "^22.5.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', setupFiles: ['dotenv/config'] },
});
```

`apps/api/.env.example`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/memoize"
JWT_SECRET="change-me-in-production"
RESEND_API_KEY="re_xxx"
PORT=4000
```

Copy this to `apps/api/.env` with a real local Postgres connection string before running the app or tests.

- [ ] **Step 4: Write the failing health-check test**

`apps/api/tests/health.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run (from `apps/api`): `npm install` then `npx vitest run tests/health.test.ts`
Expected: FAIL — `Cannot find module '../src/app.js'`

- [ ] **Step 6: Implement the Express app and entrypoint**

`apps/api/src/app.ts`:
```ts
import express from 'express';
import cookieParser from 'cookie-parser';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
```

`apps/api/src/index.ts`:
```ts
import 'dotenv/config';
import { createApp } from './app.js';

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const app = createApp();

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/health.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.base.json .gitignore packages/shared apps/api
git commit -m "feat: scaffold monorepo with health check endpoint"
```

---

### Task 2: Data model, topic seed, and GET /api/topics

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/seed.ts`
- Create: `apps/api/src/db.ts`
- Create: `apps/api/src/routes/topics.routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/topics.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks besides `createApp()`.
- Produces: `prisma` client singleton from `apps/api/src/db.ts` (used by every later task), `topicsRouter` mounted at `/api/topics`.

- [ ] **Step 1: Write the full Prisma schema**

`apps/api/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                String    @id @default(uuid())
  email             String    @unique
  passwordHash      String
  leetcodeUsername  String?
  currentStreak     Int       @default(0)
  longestStreak     Int       @default(0)
  lastActiveDate    DateTime?
  createdAt         DateTime  @default(now())

  userProblems  UserProblem[]
  dailyActivity DailyActivity[]
  monthlyGoals  MonthlyGoal[]
}

model Topic {
  id   String @id @default(uuid())
  name String @unique
  slug String @unique

  problemTopics ProblemTopic[]
  goalTargets   GoalTopicTarget[]
}

model Problem {
  id           String @id @default(uuid())
  leetcodeSlug String? @unique
  title        String
  url          String
  difficulty   String

  problemTopics ProblemTopic[]
  userProblems  UserProblem[]
}

model ProblemTopic {
  problemId String
  topicId   String

  problem Problem @relation(fields: [problemId], references: [id])
  topic   Topic   @relation(fields: [topicId], references: [id])

  @@id([problemId, topicId])
}

model UserProblem {
  id            String    @id @default(uuid())
  userId        String
  problemId     String
  status        String
  needsRevision Boolean   @default(false)
  notes         String?
  source        String
  firstSolvedAt DateTime?
  lastTouchedAt DateTime  @default(now()) @updatedAt

  user    User    @relation(fields: [userId], references: [id])
  problem Problem @relation(fields: [problemId], references: [id])

  @@unique([userId, problemId])
}

model DailyActivity {
  id                  String   @id @default(uuid())
  userId              String
  date                DateTime
  problemsSolvedCount Int      @default(0)

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, date])
}

model MonthlyGoal {
  id          String @id @default(uuid())
  userId      String
  year        Int
  month       Int
  totalTarget Int

  user         User              @relation(fields: [userId], references: [id])
  topicTargets GoalTopicTarget[]

  @@unique([userId, year, month])
}

model GoalTopicTarget {
  id          String @id @default(uuid())
  goalId      String
  topicId     String
  targetCount Int

  goal  MonthlyGoal @relation(fields: [goalId], references: [id])
  topic Topic       @relation(fields: [topicId], references: [id])

  @@unique([goalId, topicId])
}
```

`status`, `difficulty`, and `source` are plain strings, validated by `zod` at the API boundary (not Prisma enums) — keeps migrations simple since these are only ever set through validated API code paths.

- [ ] **Step 2: Run the migration against your local dev database**

Make sure `apps/api/.env` has a valid `DATABASE_URL` pointing at a running local Postgres instance, then run (from `apps/api`):
```bash
npx prisma migrate dev --name init
```
Expected: migration succeeds, `Problem`, `Topic`, `User`, etc. tables exist.

- [ ] **Step 3: Create the Prisma client singleton**

`apps/api/src/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
```

- [ ] **Step 4: Create and run the topic seed script**

`apps/api/prisma/seed.ts`:
```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TOPICS = [
  'Array', 'String', 'Hash Table', 'Dynamic Programming', 'Math',
  'Sorting', 'Greedy', 'Depth-First Search', 'Breadth-First Search',
  'Binary Search', 'Tree', 'Graph', 'Two Pointers', 'Backtracking',
  'Stack', 'Heap (Priority Queue)', 'Linked List', 'Sliding Window',
  'Bit Manipulation', 'Union Find', 'Trie', 'Recursion',
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function main() {
  for (const name of TOPICS) {
    await prisma.topic.upsert({
      where: { name },
      update: {},
      create: { name, slug: slugify(name) },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
```

Run: `npx tsx prisma/seed.ts`
Expected: no errors; `Topic` table has 22 rows.

- [ ] **Step 5: Write the failing test for GET /api/topics**

`apps/api/tests/topics.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

describe('GET /api/topics', () => {
  beforeAll(async () => {
    await prisma.topic.upsert({
      where: { name: 'Array' },
      update: {},
      create: { name: 'Array', slug: 'array' },
    });
  });

  it('returns seeded topics', async () => {
    const app = createApp();
    const res = await request(app).get('/api/topics');
    expect(res.status).toBe(200);
    expect(res.body.some((t: { name: string }) => t.name === 'Array')).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/topics.test.ts`
Expected: FAIL with 404 (route doesn't exist yet)

- [ ] **Step 7: Implement the topics route and wire it in**

`apps/api/src/routes/topics.routes.ts`:
```ts
import { Router } from 'express';
import { prisma } from '../db.js';

export const topicsRouter = Router();

topicsRouter.get('/', async (_req, res) => {
  const topics = await prisma.topic.findMany({ orderBy: { name: 'asc' } });
  res.json(topics.map((t) => ({ id: t.id, name: t.name, slug: t.slug })));
});
```

Modify `apps/api/src/app.ts` — add the import and mount:
```ts
import { topicsRouter } from './routes/topics.routes.js';
// ...inside createApp(), after app.get('/health', ...):
app.use('/api/topics', topicsRouter);
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/topics.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma apps/api/src/db.ts apps/api/src/routes/topics.routes.ts apps/api/src/app.ts apps/api/tests/topics.test.ts
git commit -m "feat: add data model, topic seed, and GET /api/topics"
```

---

### Task 3: Auth (signup, login, logout, requireAuth) + GET /api/me

**Files:**
- Create: `apps/api/src/middleware/auth.ts`
- Create: `apps/api/src/routes/auth.routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/auth.test.ts`

**Interfaces:**
- Produces: `signToken(userId): string`, `setAuthCookie(res, token)`, `clearAuthCookie(res)`, `requireAuth` middleware, and `AuthedRequest` type (adds `userId?: string` to Express's `Request`) from `apps/api/src/middleware/auth.ts` — every protected route in later tasks imports `requireAuth` and `AuthedRequest`.
- Produces: `authRouter` mounted at `/api/auth` with `POST /signup`, `POST /login`, `POST /logout`.

- [ ] **Step 1: Write the failing auth-flow test**

`apps/api/tests/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('auth flow', () => {
  const app = createApp();
  const email = `test-${Date.now()}@example.com`;
  const password = 'password123';

  it('signs up a new user and sets a session cookie', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email, password });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects /api/me without a session', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('logs in and accesses /api/me with the session cookie', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers['set-cookie'];

    const meRes = await request(app).get('/api/me').set('Cookie', cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.userId).toBe(loginRes.body.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL with 404 on `/api/auth/signup`

- [ ] **Step 3: Implement the auth middleware**

`apps/api/src/middleware/auth.ts`:
```ts
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const COOKIE_NAME = 'token';

export interface AuthedRequest extends Request {
  userId?: string;
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}
```

- [ ] **Step 4: Implement the auth routes**

`apps/api/src/routes/auth.routes.ts`:
```ts
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { signToken, setAuthCookie, clearAuthCookie } from '../middleware/auth.js';

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

authRouter.post('/signup', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  const token = signToken(user.id);
  setAuthCookie(res, token);
  res.status(201).json({ id: user.id, email: user.email });
});

authRouter.post('/login', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = signToken(user.id);
  setAuthCookie(res, token);
  res.json({ id: user.id, email: user.email });
});

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.status(204).send();
});
```

Modify `apps/api/src/app.ts` — add imports and mount the router plus `/api/me`:
```ts
import { authRouter } from './routes/auth.routes.js';
import { requireAuth, type AuthedRequest } from './middleware/auth.js';
// ...inside createApp(), after app.use('/api/topics', topicsRouter):
app.use('/api/auth', authRouter);

app.get('/api/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ userId: req.userId });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/routes/auth.routes.ts apps/api/src/app.ts apps/api/tests/auth.test.ts
git commit -m "feat: add JWT-cookie auth (signup, login, logout, requireAuth)"
```

---

### Task 4: Streak service + GET /api/streak

**Files:**
- Create: `apps/api/src/services/streak.service.ts`
- Create: `apps/api/src/routes/streak.routes.ts`
- Create: `apps/api/tests/helpers.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/streak.service.test.ts`
- Test: `apps/api/tests/streak.integration.test.ts`

**Interfaces:**
- Consumes: `prisma` from `../db.js`.
- Produces: `computeStreaks(sortedDateStrings: string[]): { currentStreak: number; longestStreak: number }` (pure), `recordSolve(userId: string, solvedAt: Date): Promise<{ currentStreak: number; longestStreak: number }>` — Task 5 (problem logging) and Task 10 (LeetCode sync) both call `recordSolve`.
- Produces: `signupAndLogin(app: Express): Promise<{ cookie: string[]; userId: string }>` test helper — every later HTTP test file uses this to get an authenticated session.
- Produces: `streakRouter` mounted at `/api/streak`.

- [ ] **Step 1: Write the failing pure-logic unit test**

`apps/api/tests/streak.service.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeStreaks } from '../src/services/streak.service.js';

describe('computeStreaks', () => {
  it('returns zero for no activity', () => {
    expect(computeStreaks([])).toEqual({ currentStreak: 0, longestStreak: 0 });
  });

  it('counts a run of consecutive days', () => {
    expect(computeStreaks(['2026-09-15', '2026-09-16', '2026-09-17'])).toEqual({
      currentStreak: 3,
      longestStreak: 3,
    });
  });

  it('resets the current streak after a gap but keeps the longest', () => {
    const dates = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-15'];
    expect(computeStreaks(dates)).toEqual({ currentStreak: 1, longestStreak: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/streak.service.test.ts`
Expected: FAIL — `Cannot find module '../src/services/streak.service.js'`

- [ ] **Step 3: Implement the streak service**

`apps/api/src/services/streak.service.ts`:
```ts
import { prisma } from '../db.js';

export function computeStreaks(sortedDateStrings: string[]): { currentStreak: number; longestStreak: number } {
  if (sortedDateStrings.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  let longest = 1;
  let run = 1;

  for (let i = 1; i < sortedDateStrings.length; i++) {
    const prev = new Date(sortedDateStrings[i - 1]);
    const curr = new Date(sortedDateStrings[i]);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);

    if (diffDays === 1) {
      run += 1;
    } else if (diffDays > 1) {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  return { currentStreak: run, longestStreak: longest };
}

function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function recordSolve(
  userId: string,
  solvedAt: Date,
): Promise<{ currentStreak: number; longestStreak: number }> {
  const day = toDateOnly(solvedAt);

  await prisma.dailyActivity.upsert({
    where: { userId_date: { userId, date: day } },
    update: { problemsSolvedCount: { increment: 1 } },
    create: { userId, date: day, problemsSolvedCount: 1 },
  });

  const activity = await prisma.dailyActivity.findMany({
    where: { userId, problemsSolvedCount: { gt: 0 } },
    orderBy: { date: 'asc' },
    select: { date: true },
  });

  const dateStrings = activity.map((a) => a.date.toISOString().slice(0, 10));
  const { currentStreak, longestStreak } = computeStreaks(dateStrings);

  await prisma.user.update({
    where: { id: userId },
    data: { currentStreak, longestStreak, lastActiveDate: day },
  });

  return { currentStreak, longestStreak };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/streak.service.test.ts`
Expected: PASS

- [ ] **Step 5: Create the shared test helper**

`apps/api/tests/helpers.ts`:
```ts
import request from 'supertest';
import type { Express } from 'express';

export async function signupAndLogin(app: Express): Promise<{ cookie: string[]; userId: string }> {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'password123';
  await request(app).post('/api/auth/signup').send({ email, password });
  const loginRes = await request(app).post('/api/auth/login').send({ email, password });
  return { cookie: loginRes.headers['set-cookie'], userId: loginRes.body.id as string };
}
```

- [ ] **Step 6: Write the failing integration test for GET /api/streak**

`apps/api/tests/streak.integration.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { recordSolve } from '../src/services/streak.service.js';
import { signupAndLogin } from './helpers.js';

describe('GET /api/streak', () => {
  it('reflects a recorded solve', async () => {
    const app = createApp();
    const { cookie, userId } = await signupAndLogin(app);

    await recordSolve(userId, new Date());

    const res = await request(app).get('/api/streak').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(1);
    expect(res.body.longestStreak).toBe(1);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/streak.integration.test.ts`
Expected: FAIL with 404 on `/api/streak`

- [ ] **Step 8: Implement the streak route and wire it in**

`apps/api/src/routes/streak.routes.ts`:
```ts
import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const streakRouter = Router();

streakRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
  res.json({ currentStreak: user.currentStreak, longestStreak: user.longestStreak });
});
```

Modify `apps/api/src/app.ts`:
```ts
import { streakRouter } from './routes/streak.routes.js';
// ...inside createApp():
app.use('/api/streak', streakRouter);
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/streak.integration.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/services/streak.service.ts apps/api/src/routes/streak.routes.ts apps/api/src/app.ts apps/api/tests/helpers.ts apps/api/tests/streak.service.test.ts apps/api/tests/streak.integration.test.ts
git commit -m "feat: add streak calculation service and GET /api/streak"
```

---

### Task 5: Problem logging (POST /api/problems/log)

**Files:**
- Create: `apps/api/src/routes/problems.routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/problems.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `AuthedRequest` from `../middleware/auth.js`; `recordSolve` from `../services/streak.service.js`; `signupAndLogin` from `./helpers.js`.
- Produces: `problemsRouter` mounted at `/api/problems` with `POST /log` — Task 6 adds `GET /` to this same router and file.

- [ ] **Step 1: Write the failing test**

`apps/api/tests/problems.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signupAndLogin } from './helpers.js';

describe('POST /api/problems/log', () => {
  it('logs a solved problem and returns 201', async () => {
    const app = createApp();
    const { cookie } = await signupAndLogin(app);

    const res = await request(app)
      .post('/api/problems/log')
      .set('Cookie', cookie)
      .send({
        title: 'Two Sum',
        url: 'https://leetcode.com/problems/two-sum/',
        leetcodeSlug: `two-sum-${Date.now()}`,
        difficulty: 'easy',
        topics: ['Array', 'Hash Table'],
        status: 'solved',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('solved');
  });

  it('rejects without authentication', async () => {
    const app = createApp();
    const res = await request(app).post('/api/problems/log').send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/problems.test.ts`
Expected: FAIL with 404 on `/api/problems/log`

- [ ] **Step 3: Implement the problem logging route**

`apps/api/src/routes/problems.routes.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { recordSolve } from '../services/streak.service.js';

export const problemsRouter = Router();

const logProblemSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  leetcodeSlug: z.string().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  topics: z.array(z.string().min(1)).min(1),
  status: z.enum(['not_started', 'attempted', 'solved']),
  notes: z.string().optional(),
});

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

problemsRouter.post('/log', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = logProblemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { title, url, leetcodeSlug, difficulty, topics, status, notes } = parsed.data;
  const userId = req.userId!;

  const problem = leetcodeSlug
    ? await prisma.problem.upsert({
        where: { leetcodeSlug },
        update: {},
        create: { title, url, leetcodeSlug, difficulty },
      })
    : await prisma.problem.create({ data: { title, url, difficulty } });

  for (const name of topics) {
    const topic = await prisma.topic.upsert({
      where: { name },
      update: {},
      create: { name, slug: slugify(name) },
    });
    await prisma.problemTopic.upsert({
      where: { problemId_topicId: { problemId: problem.id, topicId: topic.id } },
      update: {},
      create: { problemId: problem.id, topicId: topic.id },
    });
  }

  const existing = await prisma.userProblem.findUnique({
    where: { userId_problemId: { userId, problemId: problem.id } },
  });

  const userProblem = await prisma.userProblem.upsert({
    where: { userId_problemId: { userId, problemId: problem.id } },
    update: {
      status,
      notes: notes ?? undefined,
      firstSolvedAt:
        status === 'solved' ? (existing?.firstSolvedAt ?? new Date()) : existing?.firstSolvedAt,
    },
    create: {
      userId,
      problemId: problem.id,
      status,
      notes,
      source: 'manual',
      firstSolvedAt: status === 'solved' ? new Date() : null,
    },
  });

  if (status === 'solved' && !existing?.firstSolvedAt) {
    await recordSolve(userId, new Date());
  }

  res.status(201).json({ id: userProblem.id, problemId: problem.id, status: userProblem.status });
});
```

Modify `apps/api/src/app.ts`:
```ts
import { problemsRouter } from './routes/problems.routes.js';
// ...inside createApp():
app.use('/api/problems', problemsRouter);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/problems.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/problems.routes.ts apps/api/src/app.ts apps/api/tests/problems.test.ts
git commit -m "feat: add manual problem logging endpoint"
```

---

### Task 6: Problems list + revision list

**Files:**
- Modify: `apps/api/src/routes/problems.routes.ts` (add `GET /`)
- Create: `apps/api/src/routes/revision.routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/tests/problems.test.ts` (add list test)
- Test: `apps/api/tests/revision.test.ts`

**Interfaces:**
- Produces: `GET /api/problems` (list, includes `problem.topics`), `revisionRouter` mounted at `/api/revision` with `GET /` and `PATCH /:userProblemId`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/problems.test.ts`:
```ts
describe('GET /api/problems', () => {
  it('lists the current user\'s logged problems with topics', async () => {
    const app = createApp();
    const { cookie } = await signupAndLogin(app);

    await request(app)
      .post('/api/problems/log')
      .set('Cookie', cookie)
      .send({
        title: 'Valid Anagram',
        url: 'https://leetcode.com/problems/valid-anagram/',
        leetcodeSlug: `valid-anagram-${Date.now()}`,
        difficulty: 'easy',
        topics: ['Hash Table'],
        status: 'attempted',
      });

    const res = await request(app).get('/api/problems').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].problem.topics.map((t: { name: string }) => t.name)).toContain('Hash Table');
  });
});
```

`apps/api/tests/revision.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signupAndLogin } from './helpers.js';

describe('revision list', () => {
  it('flags a problem for revision and lists it', async () => {
    const app = createApp();
    const { cookie } = await signupAndLogin(app);

    const logRes = await request(app)
      .post('/api/problems/log')
      .set('Cookie', cookie)
      .send({
        title: 'Valid Parentheses',
        url: 'https://leetcode.com/problems/valid-parentheses/',
        leetcodeSlug: `valid-parentheses-${Date.now()}`,
        difficulty: 'easy',
        topics: ['Stack'],
        status: 'solved',
      });

    const toggleRes = await request(app)
      .patch(`/api/revision/${logRes.body.id}`)
      .set('Cookie', cookie)
      .send({ needsRevision: true });
    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.needsRevision).toBe(true);

    const listRes = await request(app).get('/api/revision').set('Cookie', cookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].problem.title).toBe('Valid Parentheses');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/problems.test.ts tests/revision.test.ts`
Expected: FAIL — `GET /api/problems` returns 404 (only `/log` exists); revision endpoints don't exist.

- [ ] **Step 3: Implement GET /api/problems**

Append to `apps/api/src/routes/problems.routes.ts`:
```ts
problemsRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const userProblems = await prisma.userProblem.findMany({
    where: { userId: req.userId! },
    orderBy: { lastTouchedAt: 'desc' },
    include: { problem: { include: { problemTopics: { include: { topic: true } } } } },
  });

  res.json(
    userProblems.map((up) => ({
      id: up.id,
      status: up.status,
      needsRevision: up.needsRevision,
      notes: up.notes,
      source: up.source,
      firstSolvedAt: up.firstSolvedAt,
      lastTouchedAt: up.lastTouchedAt,
      problem: {
        id: up.problem.id,
        title: up.problem.title,
        url: up.problem.url,
        difficulty: up.problem.difficulty,
        leetcodeSlug: up.problem.leetcodeSlug,
        topics: up.problem.problemTopics.map((pt) => ({
          id: pt.topic.id,
          name: pt.topic.name,
          slug: pt.topic.slug,
        })),
      },
    })),
  );
});
```

- [ ] **Step 4: Implement the revision routes**

`apps/api/src/routes/revision.routes.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const revisionRouter = Router();

revisionRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const items = await prisma.userProblem.findMany({
    where: { userId: req.userId!, needsRevision: true },
    include: { problem: true },
    orderBy: { lastTouchedAt: 'desc' },
  });

  res.json(
    items.map((up) => ({
      id: up.id,
      notes: up.notes,
      problem: {
        id: up.problem.id,
        title: up.problem.title,
        url: up.problem.url,
        difficulty: up.problem.difficulty,
      },
    })),
  );
});

const toggleSchema = z.object({ needsRevision: z.boolean() });

revisionRouter.patch('/:userProblemId', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const userProblem = await prisma.userProblem.findUnique({ where: { id: req.params.userProblemId } });
  if (!userProblem || userProblem.userId !== req.userId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const updated = await prisma.userProblem.update({
    where: { id: req.params.userProblemId },
    data: { needsRevision: parsed.data.needsRevision },
  });

  res.json({ id: updated.id, needsRevision: updated.needsRevision });
});
```

Modify `apps/api/src/app.ts`:
```ts
import { revisionRouter } from './routes/revision.routes.js';
// ...inside createApp():
app.use('/api/revision', revisionRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/problems.test.ts tests/revision.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/problems.routes.ts apps/api/src/routes/revision.routes.ts apps/api/src/app.ts apps/api/tests/problems.test.ts apps/api/tests/revision.test.ts
git commit -m "feat: add problems list and revision list endpoints"
```

---

### Task 7: Topic progress (GET /api/topics/progress)

**Files:**
- Modify: `apps/api/src/routes/topics.routes.ts`
- Modify: `apps/api/tests/topics.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `AuthedRequest`.
- Produces: `GET /api/topics/progress` — per-topic `{ topic, solvedCount, totalCount, byDifficulty }`.

- [ ] **Step 1: Write the failing test**

Add `import { signupAndLogin } from './helpers.js';` to the top of `apps/api/tests/topics.test.ts` alongside its existing imports, then append this block:
```ts
describe('GET /api/topics/progress', () => {
  it('computes per-topic progress for the current user', async () => {
    const app = createApp();
    const { cookie } = await signupAndLogin(app);

    await request(app)
      .post('/api/problems/log')
      .set('Cookie', cookie)
      .send({
        title: 'Climbing Stairs',
        url: 'https://leetcode.com/problems/climbing-stairs/',
        leetcodeSlug: `climbing-stairs-${Date.now()}`,
        difficulty: 'easy',
        topics: ['Dynamic Programming'],
        status: 'solved',
      });

    const res = await request(app).get('/api/topics/progress').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const dp = res.body.find((t: { topic: { name: string } }) => t.topic.name === 'Dynamic Programming');
    expect(dp.solvedCount).toBe(1);
    expect(dp.byDifficulty.easy.solved).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/topics.test.ts`
Expected: FAIL with 404 on `/api/topics/progress`

- [ ] **Step 3: Implement the topic progress route**

Append to `apps/api/src/routes/topics.routes.ts` (add the `requireAuth`/`AuthedRequest` import at the top):
```ts
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

topicsRouter.get('/progress', requireAuth, async (req: AuthedRequest, res) => {
  const topics = await prisma.topic.findMany({
    include: {
      problemTopics: {
        include: {
          problem: {
            include: { userProblems: { where: { userId: req.userId! } } },
          },
        },
      },
    },
  });

  const result = topics.map((topic) => {
    const problems = topic.problemTopics.map((pt) => pt.problem);
    const totalCount = problems.length;
    const solvedCount = problems.filter((p) => p.userProblems[0]?.status === 'solved').length;

    const byDifficulty: Record<'easy' | 'medium' | 'hard', { solved: number; total: number }> = {
      easy: { solved: 0, total: 0 },
      medium: { solved: 0, total: 0 },
      hard: { solved: 0, total: 0 },
    };
    for (const p of problems) {
      const d = p.difficulty as 'easy' | 'medium' | 'hard';
      byDifficulty[d].total += 1;
      if (p.userProblems[0]?.status === 'solved') byDifficulty[d].solved += 1;
    }

    return {
      topic: { id: topic.id, name: topic.name, slug: topic.slug },
      solvedCount,
      totalCount,
      byDifficulty,
    };
  });

  res.json(result);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/topics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/topics.routes.ts apps/api/tests/topics.test.ts
git commit -m "feat: add per-topic progress endpoint"
```

---

### Task 8: Monthly goals

**Files:**
- Create: `apps/api/src/routes/goals.routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/goals.test.ts`

**Interfaces:**
- Produces: `goalsRouter` mounted at `/api/goals` with `PUT /:year/:month` and `GET /:year/:month/progress`.

- [ ] **Step 1: Write the failing test**

`apps/api/tests/goals.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { signupAndLogin } from './helpers.js';

describe('monthly goals', () => {
  it('sets a goal and reports progress after solving problems', async () => {
    const app = createApp();
    const { cookie } = await signupAndLogin(app);

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const topic = await prisma.topic.upsert({
      where: { name: 'Array' },
      update: {},
      create: { name: 'Array', slug: 'array' },
    });

    const putRes = await request(app)
      .put(`/api/goals/${year}/${month}`)
      .set('Cookie', cookie)
      .send({ totalTarget: 10, topicTargets: [{ topicId: topic.id, targetCount: 5 }] });
    expect(putRes.status).toBe(200);

    await request(app)
      .post('/api/problems/log')
      .set('Cookie', cookie)
      .send({
        title: 'Two Sum',
        url: 'https://leetcode.com/problems/two-sum/',
        leetcodeSlug: `two-sum-goal-${Date.now()}`,
        difficulty: 'easy',
        topics: ['Array'],
        status: 'solved',
      });

    const progressRes = await request(app)
      .get(`/api/goals/${year}/${month}/progress`)
      .set('Cookie', cookie);
    expect(progressRes.status).toBe(200);
    expect(progressRes.body.totalTarget).toBe(10);
    expect(progressRes.body.totalSolved).toBe(1);
    expect(progressRes.body.topicTargets[0].solvedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/goals.test.ts`
Expected: FAIL with 404

- [ ] **Step 3: Implement the goals routes**

`apps/api/src/routes/goals.routes.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const goalsRouter = Router();

const goalSchema = z.object({
  totalTarget: z.number().int().positive(),
  topicTargets: z
    .array(z.object({ topicId: z.string(), targetCount: z.number().int().positive() }))
    .optional(),
});

goalsRouter.put('/:year/:month', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const userId = req.userId!;

  const goal = await prisma.monthlyGoal.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: { totalTarget: parsed.data.totalTarget },
    create: { userId, year, month, totalTarget: parsed.data.totalTarget },
  });

  if (parsed.data.topicTargets) {
    for (const t of parsed.data.topicTargets) {
      await prisma.goalTopicTarget.upsert({
        where: { goalId_topicId: { goalId: goal.id, topicId: t.topicId } },
        update: { targetCount: t.targetCount },
        create: { goalId: goal.id, topicId: t.topicId, targetCount: t.targetCount },
      });
    }
  }

  res.status(200).json({ id: goal.id, year: goal.year, month: goal.month, totalTarget: goal.totalTarget });
});

goalsRouter.get('/:year/:month/progress', requireAuth, async (req: AuthedRequest, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const userId = req.userId!;

  const goal = await prisma.monthlyGoal.findUnique({
    where: { userId_year_month: { userId, year, month } },
    include: { topicTargets: { include: { topic: true } } },
  });

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const solvedInMonth = await prisma.userProblem.findMany({
    where: { userId, status: 'solved', firstSolvedAt: { gte: monthStart, lt: monthEnd } },
    include: { problem: { include: { problemTopics: true } } },
  });

  const totalSolved = solvedInMonth.length;

  const topicTargets = (goal?.topicTargets ?? []).map((tt) => {
    const solvedCount = solvedInMonth.filter((up) =>
      up.problem.problemTopics.some((pt) => pt.topicId === tt.topicId),
    ).length;
    return { topicId: tt.topicId, topicName: tt.topic.name, targetCount: tt.targetCount, solvedCount };
  });

  res.json({ year, month, totalTarget: goal?.totalTarget ?? 0, totalSolved, topicTargets });
});
```

Modify `apps/api/src/app.ts`:
```ts
import { goalsRouter } from './routes/goals.routes.js';
// ...inside createApp():
app.use('/api/goals', goalsRouter);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/goals.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/goals.routes.ts apps/api/src/app.ts apps/api/tests/goals.test.ts
git commit -m "feat: add monthly goals with per-topic targets and progress"
```

---

### Task 9: LeetCode GraphQL client (fetch layer, mocked)

**Files:**
- Create: `apps/api/src/services/leetcode.service.ts`
- Test: `apps/api/tests/leetcode.service.test.ts`

**Interfaces:**
- Produces: `fetchRecentAcSubmissions(username: string, limit?: number): Promise<LeetCodeSubmission[]>` and `fetchQuestionDetail(titleSlug: string): Promise<LeetCodeQuestionDetail>`, plus the `LeetCodeSubmission`/`LeetCodeQuestionDetail` interfaces — Task 10's sync service imports both functions and types.

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/leetcode.service.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchRecentAcSubmissions, fetchQuestionDetail } from '../src/services/leetcode.service.js';

describe('leetcode.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses recent accepted submissions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            recentAcSubmissionList: [{ titleSlug: 'two-sum', title: 'Two Sum', timestamp: '1700000000' }],
          },
        }),
      }),
    );

    const result = await fetchRecentAcSubmissions('someuser');
    expect(result).toEqual([{ titleSlug: 'two-sum', title: 'Two Sum', timestamp: 1_700_000_000_000 }]);
  });

  it('parses question detail including topics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            question: {
              title: 'Two Sum',
              difficulty: 'Easy',
              topicTags: [{ name: 'Array' }, { name: 'Hash Table' }],
            },
          },
        }),
      }),
    );

    const result = await fetchQuestionDetail('two-sum');
    expect(result).toEqual({
      titleSlug: 'two-sum',
      title: 'Two Sum',
      difficulty: 'easy',
      link: 'https://leetcode.com/problems/two-sum/',
      topics: ['Array', 'Hash Table'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/leetcode.service.test.ts`
Expected: FAIL — `Cannot find module '../src/services/leetcode.service.js'`

- [ ] **Step 3: Implement the LeetCode client**

`apps/api/src/services/leetcode.service.ts`:
```ts
export interface LeetCodeSubmission {
  titleSlug: string;
  title: string;
  timestamp: number;
}

export interface LeetCodeQuestionDetail {
  titleSlug: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  link: string;
  topics: string[];
}

const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';

export async function fetchRecentAcSubmissions(username: string, limit = 20): Promise<LeetCodeSubmission[]> {
  const query = `
    query recentAcSubmissions($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        titleSlug
        title
        timestamp
      }
    }
  `;

  const res = await fetch(LEETCODE_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { username, limit } }),
  });

  if (!res.ok) {
    throw new Error(`LeetCode API error: ${res.status}`);
  }

  const json = (await res.json()) as {
    data: { recentAcSubmissionList: { titleSlug: string; title: string; timestamp: string }[] };
  };

  return json.data.recentAcSubmissionList.map((s) => ({
    titleSlug: s.titleSlug,
    title: s.title,
    timestamp: Number(s.timestamp) * 1000,
  }));
}

export async function fetchQuestionDetail(titleSlug: string): Promise<LeetCodeQuestionDetail> {
  const query = `
    query questionDetail($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title
        difficulty
        topicTags { name }
      }
    }
  `;

  const res = await fetch(LEETCODE_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { titleSlug } }),
  });

  if (!res.ok) {
    throw new Error(`LeetCode API error: ${res.status}`);
  }

  const json = (await res.json()) as {
    data: { question: { title: string; difficulty: string; topicTags: { name: string }[] } };
  };
  const q = json.data.question;

  return {
    titleSlug,
    title: q.title,
    difficulty: q.difficulty.toLowerCase() as 'easy' | 'medium' | 'hard',
    link: `https://leetcode.com/problems/${titleSlug}/`,
    topics: q.topicTags.map((t) => t.name),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/leetcode.service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/leetcode.service.ts apps/api/tests/leetcode.service.test.ts
git commit -m "feat: add LeetCode GraphQL client for submissions and question detail"
```

---

### Task 10: LeetCode sync orchestration + manual trigger + cron

**Files:**
- Create: `apps/api/src/services/sync.service.ts`
- Create: `apps/api/src/routes/sync.routes.ts`
- Create: `apps/api/src/jobs/syncJob.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/sync.service.test.ts`

**Interfaces:**
- Consumes: `fetchRecentAcSubmissions`, `fetchQuestionDetail` from `../services/leetcode.service.js`; `recordSolve` from `../services/streak.service.js`.
- Produces: `syncUserWithLeetCode(userId: string, leetcodeUsername: string): Promise<{ newlySolved: number }>`; `POST /api/sync/me`; `scheduleSyncJob(): void` called from `index.ts`.

- [ ] **Step 1: Write the failing test**

`apps/api/tests/sync.service.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { syncUserWithLeetCode } from '../src/services/sync.service.js';
import * as leetcodeService from '../src/services/leetcode.service.js';
import { prisma } from '../src/db.js';
import { createApp } from '../src/app.js';
import { signupAndLogin } from './helpers.js';

describe('syncUserWithLeetCode', () => {
  it('imports a new solved problem and updates the streak', async () => {
    const app = createApp();
    const { userId } = await signupAndLogin(app);
    const slug = `sync-two-sum-${Date.now()}`;

    vi.spyOn(leetcodeService, 'fetchRecentAcSubmissions').mockResolvedValue([
      { titleSlug: slug, title: 'Two Sum', timestamp: Date.now() },
    ]);
    vi.spyOn(leetcodeService, 'fetchQuestionDetail').mockResolvedValue({
      titleSlug: slug,
      title: 'Two Sum',
      difficulty: 'easy',
      link: `https://leetcode.com/problems/${slug}/`,
      topics: ['Array'],
    });

    const result = await syncUserWithLeetCode(userId, 'someuser');
    expect(result.newlySolved).toBe(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currentStreak).toBe(1);

    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync.service.test.ts`
Expected: FAIL — `Cannot find module '../src/services/sync.service.js'`

- [ ] **Step 3: Implement the sync service**

`apps/api/src/services/sync.service.ts`:
```ts
import { prisma } from '../db.js';
import { fetchRecentAcSubmissions, fetchQuestionDetail } from './leetcode.service.js';
import { recordSolve } from './streak.service.js';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function syncUserWithLeetCode(
  userId: string,
  leetcodeUsername: string,
): Promise<{ newlySolved: number }> {
  const submissions = await fetchRecentAcSubmissions(leetcodeUsername);
  let newlySolved = 0;

  for (const submission of submissions) {
    let problem = await prisma.problem.findUnique({ where: { leetcodeSlug: submission.titleSlug } });

    if (!problem) {
      const detail = await fetchQuestionDetail(submission.titleSlug);
      problem = await prisma.problem.create({
        data: {
          leetcodeSlug: detail.titleSlug,
          title: detail.title,
          url: detail.link,
          difficulty: detail.difficulty,
        },
      });

      for (const name of detail.topics) {
        const topic = await prisma.topic.upsert({
          where: { name },
          update: {},
          create: { name, slug: slugify(name) },
        });
        await prisma.problemTopic.upsert({
          where: { problemId_topicId: { problemId: problem.id, topicId: topic.id } },
          update: {},
          create: { problemId: problem.id, topicId: topic.id },
        });
      }
    }

    const existing = await prisma.userProblem.findUnique({
      where: { userId_problemId: { userId, problemId: problem.id } },
    });

    if (existing?.status === 'solved') {
      continue;
    }

    const solvedAt = new Date(submission.timestamp);
    await prisma.userProblem.upsert({
      where: { userId_problemId: { userId, problemId: problem.id } },
      update: { status: 'solved', firstSolvedAt: solvedAt },
      create: { userId, problemId: problem.id, status: 'solved', source: 'imported', firstSolvedAt: solvedAt },
    });

    await recordSolve(userId, solvedAt);
    newlySolved += 1;
  }

  return { newlySolved };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync.service.test.ts`
Expected: PASS

- [ ] **Step 5: Add the manual trigger route**

`apps/api/src/routes/sync.routes.ts`:
```ts
import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { syncUserWithLeetCode } from '../services/sync.service.js';

export const syncRouter = Router();

syncRouter.post('/me', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
  if (!user.leetcodeUsername) {
    res.status(400).json({ error: 'No LeetCode username set for this account' });
    return;
  }

  const result = await syncUserWithLeetCode(user.id, user.leetcodeUsername);
  res.json(result);
});
```

Modify `apps/api/src/app.ts`:
```ts
import { syncRouter } from './routes/sync.routes.js';
// ...inside createApp():
app.use('/api/sync', syncRouter);
```

- [ ] **Step 6: Add the cron job**

`apps/api/src/jobs/syncJob.ts`:
```ts
import cron from 'node-cron';
import { prisma } from '../db.js';
import { syncUserWithLeetCode } from '../services/sync.service.js';

export function scheduleSyncJob(): void {
  cron.schedule('0 */6 * * *', async () => {
    const users = await prisma.user.findMany({ where: { leetcodeUsername: { not: null } } });
    for (const user of users) {
      try {
        await syncUserWithLeetCode(user.id, user.leetcodeUsername!);
      } catch (err) {
        console.error(`Sync failed for user ${user.id}:`, err);
      }
    }
  });
}
```

Modify `apps/api/src/index.ts` — schedule the job at startup (not inside `createApp()`, so tests that call `createApp()` never start the cron):
```ts
import { scheduleSyncJob } from './jobs/syncJob.js';
// ...after app.listen(...):
scheduleSyncJob();
```

- [ ] **Step 7: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/sync.service.ts apps/api/src/routes/sync.routes.ts apps/api/src/jobs/syncJob.ts apps/api/src/app.ts apps/api/src/index.ts apps/api/tests/sync.service.test.ts
git commit -m "feat: add LeetCode sync orchestration, manual trigger, and cron job"
```

---

### Task 11: Reminder emails

**Files:**
- Create: `apps/api/src/services/email.service.ts`
- Create: `apps/api/src/jobs/reminderJob.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/email.service.test.ts`

**Interfaces:**
- Produces: `buildReminderDigest(input: ReminderDigestInput): { subject: string; body: string } | null` (pure), `sendReminderEmail(to: string, digest): Promise<void>`, `scheduleReminderJob(): void` called from `index.ts`.

- [ ] **Step 1: Write the failing test**

`apps/api/tests/email.service.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildReminderDigest } from '../src/services/email.service.js';

describe('buildReminderDigest', () => {
  it('returns null when there is nothing to report', () => {
    expect(buildReminderDigest({ revisionCount: 0, streakAtRisk: false, currentStreak: 0 })).toBeNull();
  });

  it('mentions the revision count when problems are flagged', () => {
    const digest = buildReminderDigest({ revisionCount: 3, streakAtRisk: false, currentStreak: 5 });
    expect(digest?.body).toContain('3 problem(s)');
  });

  it('mentions streak risk when applicable', () => {
    const digest = buildReminderDigest({ revisionCount: 0, streakAtRisk: true, currentStreak: 5 });
    expect(digest?.body).toContain('5-day streak');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/email.service.test.ts`
Expected: FAIL — `Cannot find module '../src/services/email.service.js'`

- [ ] **Step 3: Implement the email service**

`apps/api/src/services/email.service.ts`:
```ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface ReminderDigestInput {
  revisionCount: number;
  streakAtRisk: boolean;
  currentStreak: number;
}

export function buildReminderDigest(input: ReminderDigestInput): { subject: string; body: string } | null {
  if (input.revisionCount === 0 && !input.streakAtRisk) {
    return null;
  }

  const lines: string[] = [];
  if (input.revisionCount > 0) {
    lines.push(`You have ${input.revisionCount} problem(s) flagged for revision.`);
  }
  if (input.streakAtRisk) {
    lines.push(`Your ${input.currentStreak}-day streak is at risk — solve a problem today to keep it alive!`);
  }

  return { subject: 'Your Memoize daily digest', body: lines.join('\n') };
}

export async function sendReminderEmail(to: string, digest: { subject: string; body: string }): Promise<void> {
  await resend.emails.send({
    from: 'Memoize <reminders@memoize.app>',
    to,
    subject: digest.subject,
    text: digest.body,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/email.service.test.ts`
Expected: PASS

- [ ] **Step 5: Add the reminder cron job**

`apps/api/src/jobs/reminderJob.ts`:
```ts
import cron from 'node-cron';
import { prisma } from '../db.js';
import { buildReminderDigest, sendReminderEmail } from '../services/email.service.js';

function isToday(date: Date | null): boolean {
  if (!date) return false;
  const now = new Date();
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
}

export function scheduleReminderJob(): void {
  cron.schedule('0 20 * * *', async () => {
    const users = await prisma.user.findMany();

    for (const user of users) {
      const revisionCount = await prisma.userProblem.count({
        where: { userId: user.id, needsRevision: true },
      });
      const streakAtRisk = user.currentStreak > 0 && !isToday(user.lastActiveDate);

      const digest = buildReminderDigest({ revisionCount, streakAtRisk, currentStreak: user.currentStreak });

      if (digest) {
        try {
          await sendReminderEmail(user.email, digest);
        } catch (err) {
          console.error(`Reminder email failed for user ${user.id}:`, err);
        }
      }
    }
  });
}
```

Modify `apps/api/src/index.ts`:
```ts
import { scheduleReminderJob } from './jobs/reminderJob.js';
// ...after scheduleSyncJob():
scheduleReminderJob();
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/email.service.ts apps/api/src/jobs/reminderJob.ts apps/api/src/index.ts apps/api/tests/email.service.test.ts
git commit -m "feat: add reminder email digest and daily cron job"
```

---

## Definition of Done

After Task 11, the backend is a complete, independently testable service:
- `npm run dev -w apps/api` starts the API on `PORT` (default 4000)
- `npx vitest run` (from `apps/api`) passes end to end
- Every spec feature (auth, manual logging, LeetCode import, revision list, streaks, topic progress, monthly goals, reminder emails) is reachable over HTTP and covered by a test

The frontend (`apps/web`) is a separate plan, written after this one is implemented and reviewed.
