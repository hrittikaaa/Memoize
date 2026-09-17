# Memoize — Design Spec

Date: 2026-09-18

Project name: **Memoize** (a personal LeetCode progress tracker).

## 1. Purpose

A personal web app to track LeetCode practice: which problems have been
solved, organized by topic, with a manual revision list, daily solve
streaks, per-topic and monthly-goal progress views, and email reminders.
Supports multiple user accounts from the start.

## 2. Scope (v1)

In scope:
- Account signup/login (email + password)
- Auto-import of solved problems from a user's LeetCode profile (public
  GraphQL API), plus manual problem entry/logging
- Per-problem notes and a manual "needs revision" flag with a revision
  list view
- Daily solve streaks (current + longest)
- Topic-by-topic progress view (solved/total, difficulty breakdown)
- Monthly goals: total problem-count target plus optional per-topic
  sub-targets, with computed progress
- Daily email digest for revision-list reminders and streak risk

Out of scope for v1 (explicitly deferred, not designed against):
- Spaced-repetition scheduling (SM-2 or similar) — revision is a
  manual flag only
- In-app push/browser notifications — email only
- Multiple notes/history per problem — a single freeform notes field
- Any UI beyond a working, reasonably clean web app (no native mobile)

## 3. Architecture

Monorepo, two deployable apps plus a shared types package:

```
leetcode-tracker/
  apps/
    api/         # Express + TypeScript REST API, Prisma/Postgres, node-cron jobs
    web/         # React + Vite + TypeScript SPA
  packages/
    shared/      # Shared TypeScript types (User, Problem, Topic, Goal, etc.)
```

**Stack:**
- API: Node.js, Express, TypeScript, Prisma ORM, Postgres
- Web: React + Vite + TypeScript, Tailwind + shadcn/ui, React Query
- Auth: bcrypt password hashing, JWT in an httpOnly cookie, Express
  middleware checks the cookie on protected routes
- Background jobs: `node-cron` running in-process in the API — one job
  for periodic LeetCode sync per user, one daily job for reminder
  emails
- Email: Resend
- Hosting (target, not needed for local dev): `apps/web` on Vercel,
  `apps/api` + Postgres on Render/Railway or a managed Postgres
  (Supabase/Neon)

**Rejected alternatives:**
- Managed auth (Clerk/Auth0): adds an external dependency and cost for
  no real benefit at this scale — rejected in favor of self-rolled JWT
  auth.
- Separate worker service for cron jobs: cleaner separation but doubles
  deployment surface — rejected in favor of in-process `node-cron`.

## 4. Data Model

```
User
  id, email, password_hash, leetcode_username (nullable),
  current_streak, longest_streak, last_active_date, created_at

Topic
  id, name, slug            -- seeded from LeetCode's known tag list

Problem                     -- global catalog, shared across all users
  id, leetcode_slug (nullable, unique), title, url,
  difficulty (easy | medium | hard)

ProblemTopic                -- many-to-many join
  problem_id, topic_id

UserProblem                 -- one row per (user, problem): personal tracking
  id, user_id, problem_id,
  status (not_started | attempted | solved),
  needs_revision (bool),
  notes (text, nullable),
  source (imported | manual),
  first_solved_at, last_touched_at

DailyActivity                -- one row per (user, date)
  user_id, date, problems_solved_count

MonthlyGoal
  id, user_id, year, month, total_target (int)

GoalTopicTarget              -- optional per-topic sub-targets for a goal
  id, goal_id, topic_id, target_count
```

Design notes:
- `Problem` and `UserProblem` are split because LeetCode problems are
  shared across users; sync for one user should never duplicate catalog
  rows, only touch that user's `UserProblem`.
- `DailyActivity` is maintained incrementally (upserted on each
  solve/sync) rather than derived live from `UserProblem` timestamps,
  so streak calculation and a future activity heatmap stay cheap
  queries.
- Topic progress and monthly-goal progress are **not** stored; both are
  computed on read via aggregation queries over `UserProblem` +
  `ProblemTopic`, scoped by date range for goals.

## 5. Key Flows

- **Auth**: signup/login → bcrypt + JWT in httpOnly cookie → all
  protected API routes verify the cookie via middleware.
- **LeetCode sync** (cron, every 6 hours, for each user with a
  `leetcode_username` set): call LeetCode's public GraphQL endpoint for
  recent submissions → upsert new problems into `Problem`/`ProblemTopic`
  → upsert that user's `UserProblem.status`/`first_solved_at` → upsert
  today's `DailyActivity` row → recompute
  `current_streak`/`longest_streak`.
- **Manual problem entry/logging**: same upsert path as sync, minus the
  external API call, with `source = manual`.
- **Revision list**: query `UserProblem` where `needs_revision = true`,
  joined to `Problem`/`Topic`.
- **Topic progress dashboard**: aggregate solved/total per topic (and
  difficulty) for the current user.
- **Monthly goals dashboard**: current month's `MonthlyGoal` +
  `GoalTopicTarget`, joined against a computed this-month solved-count
  query, rendered as progress bars.
- **Reminder email** (daily cron, fixed at 8pm UTC for v1 — no
  per-user timezone handling yet): per user, check revision-list size
  and streak risk (no activity logged yet today) → send a digest via
  Resend if there's something to report.

## 6. Error Handling

- LeetCode's API is unofficial and can break or rate-limit: sync
  failures are logged per-user and never block the rest of the app;
  the UI shows the last successful sync time so staleness is visible.
- All API input is validated with `zod`; errors return a consistent
  `{ error }` JSON shape with an appropriate 4xx/5xx status.

## 7. Testing

- Vitest for unit tests: streak calculation, goal-progress calculation,
  LeetCode response parsing/upsert logic.
- Integration tests against a test Postgres database for core API
  routes: auth, logging a solve, revision list, goals.
- No end-to-end/browser testing in v1 — deferred until the UI
  stabilizes.

## 8. Tooling & Skills for Implementation

- Monorepo via npm workspaces (no Turborepo/Nx needed at this size)
- Prisma migrate for schema/migrations (`apps/api/prisma/schema.prisma`)
- ESLint + Prettier, shared root config
- Skills to invoke during implementation: `superpowers:writing-plans`
  (next step), `superpowers:test-driven-development`,
  `supabase`/`supabase-postgres-best-practices` (if Postgres hosting is
  Supabase), `ui-styling` (shadcn/ui + Tailwind), `deploy-to-vercel`,
  `setup-deploy` (API hosting), `superpowers:systematic-debugging` (if
  LeetCode integration misbehaves), `code-review` /
  `superpowers:requesting-code-review` before merging major chunks.
