# Q&A Log

Grouped by branch, newest branch first. Each branch section has a heading with the branch name and a one-line summary.

## NS-12: POST /notifications validates and saves

### Q: What HTTP status codes did we use in NS-12, what do they mean, and why did we use them?

A: 202, 400, 404, 500 and 503 (plus 200 for a healthy `/health`). The first digit is the class: 2xx means success, 4xx means the client sent something wrong, 5xx means the server failed.

- **202 Accepted** (`POST /notifications`, `src/api/notifications.ts`): the request was valid and stored, but the work is not finished. The row is saved as `pending`; sending happens later through the queue. 201 Created would say the notification exists as a finished thing, and 200 would hide that it is asynchronous. The body is `{ id, status, created_at }` so the client can look it up later.
- **400 Bad Request** (invalid body): the client's data failed validation: `user_id` not a UUID, `channel` not `email`/`sms`/`push`, or a missing field. `src/api/validateBody.ts` returns it with the zod error details, and `src/errorHandler.ts` maps any `ZodError` to 400. It is the client's mistake, so retrying the same request will never work.
- **404 Not Found** (unknown or archived user): the body was valid, but the user it points to does not exist or is archived (`archived_at IS NOT NULL`), so nothing was inserted. Unknown and archived users get the same response. 422 Unprocessable Content would also be defensible for a valid request that refers to something missing. We chose 404 because the missing thing is the user.
- **500 Internal Server Error** (anything unexpected, e.g. a database error): a bug or failure on our side. `errorHandler` returns the fixed message `Internal Server Error` and never exposes `err.message`; the real error goes to the log. We do not return 500 for expected cases like a bad body or an unknown user. Those are 4xx.
- **503 Service Unavailable** (`/health` when the DB check fails): the server is running but cannot do its job because a dependency (Postgres) is down. Load balancers and orchestrators treat it as "take this instance out of rotation", which is the point of a health endpoint. It is not a 500, because retrying later may work. Planned in `src/app.ts`; not yet implemented when this note was added.
- **200 OK** (`/health` when healthy): plain success with `{ status: 'ok' }`.
- Rule of thumb: pick 4xx when the client can fix it, 5xx when only we can.
- General HTTP knowledge (RFC 9110), not checked against the spec or docs in this session. Which code fits "valid request, missing referenced user" (404 vs 422) is a judgement call.

### Q: How do I add a DB check to `/health` and close the pg pool on shutdown (`pool.end()`)?

A: In `src/app.ts`, make `/health` run `SELECT 1` through the shared pool (200 `{ status: 'ok' }` on success, 503 `{ status: 'error' }` on failure). For shutdown, keep the value returned by `app.listen`, and on `SIGTERM`/`SIGINT` call `server.close()` first, then `pool.end()` inside its callback.

- `/health`: log the error yourself with `logger.error({ err }, ...)`, because `/health` is excluded from request logging and a failure would otherwise be invisible. Return no error details to the client.
- Shutdown order matters: `server.close()` stops new requests and waits for in-flight ones, then `pool.end()` waits for checked-out clients to be released and closes the connections.
- Add a forced-exit timer (`setTimeout(() => process.exit(1), 10_000).unref()`), because open keep-alive connections can stop `server.close()` from finishing.
- Test: stop Postgres (`docker compose stop postgres`) and expect 503, start it again and expect `ok` (the pool reconnects), then Ctrl+C and expect a clean exit.
- This was guidance; the code was not yet written or run when this note was added. General knowledge of `pg` and Node, not checked against the docs in this session.

### Q: How was the "unknown or archived `user_id` gives a 500 (FK error 23503)" problem fixed?

A: By not tripping the foreign key at all, not by catching `23503`. The insert selects from `users`, so a missing or archived user inserts nothing and the handler returns 404.

- In `src/api/notifications.ts`: `INSERT INTO notifications (...) SELECT id, $2::varchar, $3::jsonb, 'pending', 0 FROM users WHERE id = $1 AND archived_at IS NULL RETURNING id, status, created_at`.
- Zero rows returned means 404 `User not found`. Success returns 202 with the new id.
- Tested against the real database: unknown user and archived user both gave 404 and created no row.
- Gap: if the FK ever trips another way (e.g. a user hard-deleted between check and insert), it still becomes a 500 through `errorHandler`. Unlikely, because users are archived, never deleted.
- Side effect: unknown and archived users get the same 404 message. Telling them apart would need a second query.
- `user_id` is also validated with `z.uuid()`, so a non-UUID string returns 400 instead of Postgres error `22P02` (a 500).

### Q: Where should the pg client be initialised so it isn't created again and again in the API?

A: In its own module, `src/db.ts`, which exports one `pg.Pool`. Modules are evaluated once, so every `import { pool } from '../db.ts'` shares the same instance, the same way `config.ts` and `logger.ts` work.

- Use a `Pool`, not a `Client`. A `Client` is one connection running one query at a time and does not reconnect; a `Pool` hands out connections per query, which suits concurrent requests.
- The pool connects lazily on the first query, so importing it never fails if Postgres is down.
- Add `pool.on('error', ...)` for idle connection errors, or a Postgres restart can crash the process.
- Use `pool.query(...)` for single statements; for transactions use `pool.connect()` and `client.release()` in a `finally`.
- `src/app.ts` also needed `app.use(express.json())`, otherwise `req.body` is `undefined` and every POST fails validation.
- General knowledge of `pg` and Express, not checked against the docs in this session.

## NS-11: Database migrations for Postgres

### Q: Why archive users instead of deleting them, and why is the `notifications.user_id` foreign key `ON DELETE RESTRICT`?

A: Users are archived (`users.archived_at` is set) and never hard-deleted, so their notification history stays as a trail. `RESTRICT` backs that up: deleting a user who has notifications fails with an FK violation, where `CASCADE` would silently delete the history.

- Where: `migrations/1794365209383_create-users.ts` (`archived_at`) and `migrations/1794371469906_create-notifications.ts` (`references: 'users'`, `onDelete: 'RESTRICT'`).
- `archived_at` is a nullable `timestamptz`: `NULL` means active, a timestamp means archived and records when. A boolean would lose the "when".
- The app must filter `archived_at IS NULL` when choosing who to notify. The database does not enforce that.
- `ON DELETE` options in short:
  - `CASCADE`: deleting the user deletes their notifications.
  - `RESTRICT`: blocks the delete while notifications exist. Choose this to keep an audit trail.
  - `SET NULL` would not work here, because `user_id` is `NOT NULL`.
- Trade-off: an archived user keeps their email and phone in the table. If a real "erase my data" request (e.g. GDPR) applies, archiving is not enough and you would need to anonymise the row. That is a later decision.
- The choice is also recorded as a comment on NS-11 in Jira.
- Reasoning is general database design knowledge, not checked against the Postgres docs in this session.

### Q: Which migration tool should we use, and why not just use an ORM straight away?

A: Use **node-pg-migrate** (Postgres-only, plain SQL or TS migration files, works with the `pg` driver) and skip the ORM for now. A migration tool and an ORM are separate choices. Many ORMs bundle a migrator (Prisma Migrate, Drizzle Kit, TypeORM, Sequelize), which is why they get mixed up.

- Why not an ORM yet:
  - Notification workloads are SQL-shaped: `SELECT ... FOR UPDATE SKIP LOCKED` for claiming work, partial indexes on `status`, `ON CONFLICT` for idempotency keys, JSONB payloads, maybe time partitioning. ORMs handle these awkwardly, so you often end up writing raw SQL anyway.
  - Bulk inserts and status updates are hot paths, and an ORM makes it harder to see the exact SQL that runs.
  - With a SQL-first tool the migration file is the schema change. Auto-generated diffs from ORM models can surprise you (a rename can become drop + add) and need review anyway.
  - Lock-in: schema ends up tied to the ORM's model definitions and tooling (Prisma needs a generated client). This repo is ESM with `module: nodenext` and `.ts` import extensions, so extra friction matters.
  - Writing the DDL yourself is worth it for learning on a ticket-by-ticket project.
- When an ORM is the right call: lots of CRUD across many related entities, a team that wants model-driven schema, or type safety as a top priority.
- If type safety is wanted without an ORM, add **Kysely** (typed query builder) later. **Drizzle** is the most SQL-like, ESM-friendly ORM option, and Drizzle Kit handles its migrations.
- Alternatives:
  - dbmate / Flyway: language-agnostic plain SQL, but a separate binary or JVM.
  - Knex migrations: good if Knex is also the query builder, heavier otherwise.
  - Prisma Migrate: most lock-in, generated client.
- Suggested setup: add `pg` and `node-pg-migrate`, put `.sql` migrations in `migrations/`, add `migrate:up`, `migrate:down` and `migrate:create` scripts reading the Postgres vars from `.env`, and run migrations as a CLI step, not on app start.
- General knowledge and a judgement call, not checked against the tools' docs in this session. It depends on how much the project leans on CRUD versus queue-style SQL.

## NS-10: Express + TypeScript setup with config, logging, error handler, /health

### Q: Why does the build need a different tsconfig (`tsconfig.build.json`)?

A: Because the two files do different jobs. `tsconfig.json` is for checking and editing code (typecheck, IDE, ESLint), so it has `"noEmit": true` and produces no files. The build has to emit JavaScript into `dist/`, with settings the checking config shouldn't have. `tsconfig.build.json` extends the base file and overrides only those.

- `tsconfig.json` (base): strict options, `module: nodenext`, `noEmit: true`. Used by `npx tsc --noEmit`, the editor and `typescript-eslint`. It has no `include`, so it covers every TS/JS file in the project, such as `eslint.config.js`.
- `tsconfig.build.json` (extends base):
  ```json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src" },
    "include": ["src"]
  }
  ```
  - `noEmit: false` turns emitting back on.
  - `outDir: dist` sends the output there, and `rootDir: src` makes `src/app.ts` become `dist/app.js`, not `dist/src/app.js`.
  - `include: ["src"]` builds only the app code, not config files like `eslint.config.js`.
- The base file's `rewriteRelativeImportExtensions` option is inherited. It turns `import ... from './config.ts'` into `'./config.js'` in the output, which is why `node dist/app.js` runs.
- It is not strictly required. We could put `outDir` and `include` in the one `tsconfig.json`. The split keeps the editor and lint seeing all files while the build output stays limited to `src/`. Many projects do this, but it is a choice.
- Scripts: `build` is `tsc -p tsconfig.build.json`, and `start` is `node dist/app.js`.
- General knowledge about `tsc` options, plus what we set up in this repo. Not checked against the TypeScript docs in this session.

### Q: How do I skip the automatic request log for some routes in pino (pino-http)? Example please.

A: Use the `autoLogging.ignore` option of `pino-http`. It receives the request and returns `true` for requests that should not get the automatic "request completed" log line. It is a `pino-http` option, not a core `pino` one.

- Example for `/health`, which load balancers and Docker healthchecks poll constantly (in `src/logger.ts`):
  ```ts
  export const httpLogger = pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === '/health',
    },
  });
  ```
- Several routes: `ignore: (req) => ['/health', '/metrics'].includes(req.url ?? '')`.
- Turn automatic logging off for every request: `autoLogging: false`.
- Only the automatic request line is skipped. `req.log` still works on that request, and the error handler's `req.log.error(...)` in `src/errorHandler.ts` still logs if the route fails.
- `req.url` includes the query string, so `/health?x=1` would not match `=== '/health'`. Use `req.url?.startsWith('/health')` or parse the path if that matters.
- The `autoLogging.ignore` option is also mentioned in the pkgpulse article (see the logger middleware comparison entry). The rest is from my memory of the `pino-http` docs and was not re-checked this session. Verify at https://github.com/pinojs/pino-http before relying on it.
- Not applied to the code yet. `src/logger.ts` is unchanged.

### Q: What does "headers already sent" mean in an HTTP response?

A: An HTTP response has an order: status line and headers first, then the body. Once Node writes the headers to the socket (the first `res.write()`, `res.send()`, `res.json()` or `res.end()`), they are on the wire and can no longer be changed.

- After that point the status code is fixed. You can't turn a `200` into a `500`.
- Node tracks this with `res.headersSent`, which is `true` once the headers have gone out.
- General knowledge about HTTP and Node, not checked against docs in this session.

### Q: Why does `res.status(500).json(...)` throw if headers were already sent?

A: Because it tries to set a status and headers on a response that has already started. Node refuses and throws `ERR_HTTP_HEADERS_SENT` ("Cannot set headers after they are sent to the client").

- Inside our error handler, that new throw would replace the original error, so we'd lose the real cause.
- This is the reason for the guard at the top of `src/errorHandler.ts`: `if (res.headersSent) return next(err);`.
- General knowledge, not checked against docs in this session.

### Q: When can an error happen after the headers are already sent?

A: Whenever a response is sent in several steps and something fails partway through, or code keeps running after the response was sent.

- **Streaming a file or large body:** `fs.createReadStream(...).pipe(res)` sends headers with the first chunk, then the disk read fails.
- **Chunked writes:** `res.write()` a few times, then a later step throws.
- **Missing `return` after responding:** `res.json(data)` is followed by code that throws, or a second `res.json()` runs. Example: `if (!user) res.status(404).json(...)` without `return`, then the code continues and fails.
- **Async work after `res.send()`:** a fire-and-forget step (e.g. logging, queueing a notification) fails after the client already got its response.
- General knowledge, not checked against docs in this session.

### Q: Why call `next(err)` in that case instead of sending our own error response?

A: We can't send a clean error anymore, because the status and headers are already out. Passing the error on with `next(err)` hands it to Express's built-in default error handler, which is built for this case.

- As I recall the Express error-handling guide, the default handler closes the connection when headers have already been sent. The client then sees a failed or truncated response, which is the honest outcome.
- If we did nothing, the request could hang until the client times out.
- The error still reaches the logger, so the failure is not silent.
- This is from memory of the Express docs, not re-checked in this session. Verify at https://expressjs.com/en/guide/error-handling.html before relying on it.

### Q: Why do we `return next(err)` and not just `next(err)`?

A: The `return` stops our handler from running the lines below it. Without it, the code would call `next(err)` and then still try `res.status(...).json(...)`, which throws `ERR_HTTP_HEADERS_SENT`.

- The same mistake (a missing `return` after responding) is also one of the common causes of the problem itself. See "When can an error happen after the headers are already sent?" above.
- General knowledge, not checked against docs in this session.

### Q: What are the different HTTP request logger middlewares for Express (morgan, pino-http, express-winston), and how do they differ?

A: Morgan is a simple text access logger, good for development. `pino-http` produces structured JSON and is the article's pick for production. `express-winston` suits teams already on Winston. The article's verdict: "For production APIs in 2026, pino-http is the default."

| | morgan | pino-http | express-winston |
| --- | --- | --- | --- |
| Output | Text (`GET /api/packages 200 42ms`) | Structured JSON | JSON or text (via Winston formats) |
| Request IDs | Manual | Built in (`genReqId`), passed to `req.log` child logger | Manual |
| Redaction | None | Built in (`redact`) | Limited |
| Multiple destinations | No | Write to stdout, let infrastructure route it | Yes (Winston transports) |
| Weekly downloads (Feb 2026) | ~3.5M | ~1.3M | ~500K |

- **morgan:** zero-config and human-readable, with custom tokens and a `skip` predicate. No structured JSON, so aggregators need regex parsing. Best for local dev, simple apps and legacy codebases.
- **pino-http:** works with Pino, called the fastest. JSON suits Datadog, Grafana Loki and CloudWatch. Supports `customLogLevel` by status code and `autoLogging.ignore`. Best for production APIs, correlation across services and when performance matters.
- **express-winston:** wraps Winston. Fans out to console, file and services such as Datadog or Splunk. The article calls it "operationally more complex than pino's approach". Best if you already use Winston or need several log targets.
- The article gives no benchmark numbers. Its performance claims are qualitative only.
- The article is based on morgan v1.10.x, pino-http v10.x and express-winston v4.x.
- This is a third-party blog, not official docs, and I haven't checked its claims against each library's own documentation.
- Source: https://www.pkgpulse.com/guides/morgan-vs-pino-http-vs-express-winston-http-request-2026 (dated March 9, 2026)

### Q: Why do we need a logger in this project?

A: A notification system does much of its work in the background (queues, workers, retries, external providers), where nobody sees an error unless it was recorded. A logger gives a searchable record of what happened and why. The ticket (NS-10) also asks for it: a structured logger that logs each request and logs errors from the error handler.

- Debugging: when a notification isn't delivered, logs show which step failed (API, queue, provider).
- Structured logs (JSON with fields like `level`, `msg`, request ID) can be filtered and searched by tools, unlike free-text `console.log`.
- Log levels (`error`, `warn`, `info`, `debug`) let us show less in production and more in development. `LOG_LEVEL` is already validated in `src/config.ts`.
- Request logging records each call's method, path, status and duration. This also helps spot slow or failing endpoints.
- The error-handling middleware (NS-10 step 6) needs a logger to record errors while returning a clean JSON error to the client.
- Later work (Postgres, Redis, RabbitMQ clients and consumers) will log through the same logger, so one setup serves the whole system.
- This answer is general knowledge plus the NS-10 ticket text, not checked against docs.

### Q: Why do we need typescript-eslint for a TypeScript project, and why doesn't it work with the latest TypeScript v7?

A: ESLint can't parse TypeScript on its own, so `typescript-eslint` supplies the parser and the TS-aware rules. It doesn't work with TypeScript 7 yet because its published version declares a peer dependency on an older TypeScript range.

- ESLint's default parser only understands plain JavaScript. Type annotations, interfaces and `import type` are syntax errors to it. `typescript-eslint` provides a parser that turns TS into something ESLint understands.
- It also adds TS-specific rules (e.g. `@typescript-eslint/no-unused-vars`, which understands types) and turns off core ESLint rules that give false positives on TS code.
- It builds on the TypeScript compiler's API, so each release only supports a tested range of TypeScript versions.
- In this repo, `typescript-eslint@8.72.1` declares `typescript@">=4.8.4 <6.1.0"`. The project had `typescript@7.0.2`, so `npm install` failed with `ERESOLVE`.
- Fix: `typescript` in `package.json` was changed to `~6.0`. Alternatives were `--legacy-peer-deps` (unsupported pairing, may break) or dropping `typescript-eslint`.
- Likely reason (not confirmed from docs): TS 7 is a major rewrite, and tools that use the compiler API need to be updated before they can claim support. Check the typescript-eslint release notes for when TS 7 support lands.
- Source: the npm `ERESOLVE` error output in this session; the rest is general knowledge, not checked against the docs.

## NS-9: Docker Compose setup for Postgres, Redis and RabbitMQ with healthchecks

### Q: Why did we remove the Redis username and password?

A: Because they did nothing. The official `redis` image doesn't read `REDIS_USERNAME` or `REDIS_PASSWORD`, so setting them as environment variables never enabled authentication. Redis was running without a password anyway, and the variables only gave a false sense of security.

- Removed from the `redis` service in `docker-compose.yaml`, from `.env` and from `.env.example`.
- Redis is only exposed to a local dev machine here, so running without auth is acceptable for now.
- To get a real password later, pass it to the server: `command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]`. For a username, use Redis ACLs (e.g. an ACL file or `--user` options), not env vars.
- Revisit this before anything is deployed beyond local dev.

### Q: What's the difference between `docker ps` and `docker compose ps`?

A: Scope. `docker ps` lists running containers on the whole Docker host, whatever started them. `docker compose ps` lists only the containers of the compose project in the current directory (from `docker-compose.yaml`).

- `docker ps` shows every running container on the host, including ones from other projects or started with `docker run`. Add `-a` to include stopped ones.
- `docker compose ps` is scoped to the project's services. It shows service names, status and ports, plus health (`healthy`, `unhealthy`, `starting`).
- NS-9 step 5 uses `docker compose ps` to check that all three services are healthy.
- `docker compose ps` only lists running containers by default. Use `docker compose ps -a` to also see stopped or crashed ones.
- `docker ps` also shows health in its `STATUS` column, e.g. `Up 2 minutes (healthy)`.

### Q: Why do we not need a volume for Redis in our notification system?

A: We don't strictly need one as long as Redis only holds disposable data, such as a cache. Losing it then just means a cold cache. Redis keeps data in memory, so unlike Postgres or RabbitMQ the data usually isn't the source of truth.

- The official `redis` image declares `/data` as a volume, so Docker creates an anonymous one anyway. Data survives `docker compose restart`, but not a recreate or `docker compose down -v`.
- A named volume (`redis_data:/data`) would be needed if Redis holds state we'd miss, such as dedup keys, rate-limit counters, retry state or job queues. Optionally add AOF with `--appendonly yes` for better durability.
- NS-9 asks for named volumes in general but doesn't require one for Redis specifically.
- Current leaning: add the named volume anyway because it is cheap and avoids surprises later.

> **Disclaimer:** This answer might change. It depends on what we end up storing in Redis, which isn't decided yet. Revisit it once the design settles.

### Q: How do I decide the right values for a docker compose healthcheck (`interval`, `timeout`, `retries`, `start_period`)?

A: Derive each from something you can measure, rather than guessing.

- `interval`: how often the probe runs. It sets how quickly you notice a failure, and how quickly dependents (`depends_on: condition: service_healthy`) can start. Dev: 3-5s. Prod: 10-30s, so probes don't add load.
- `timeout`: the longest one probe may take before it counts as a failure. Time the probe by hand (`time docker compose exec db pg_isready`), then use about 5-10x that, and keep it below `interval`. Too low gives false failures under load. Too high delays detection.
- `retries`: consecutive failures before the container is marked `unhealthy`. This absorbs transient blips. Use 3-5. Worst-case detection time is about `interval * retries`.
- `start_period`: a grace window after container start in which failures don't count. A success inside it still marks the container healthy immediately. Set it to your measured worst-case startup (run `docker compose up` and watch how long until `healthy`), plus some margin. Slow starters (DB recovery, migrations, JVM) need more.
- Sanity check: ask "how long can this service be broken before I want to know?" That is roughly `interval * retries`. Then ask "how long does a healthy start take?" and set `start_period` just above it.
- The probe itself should be cheap and check real readiness (e.g. `pg_isready`, `redis-cli ping`), not just that the process exists.
- Provenance: the meaning of each field and the defaults (`interval` 30s, `timeout` 30s, `retries` 3, `start_period` 0s, `start_interval` 5s) come from the Docker docs below. The numeric ranges above (3-5s dev, 10-30s prod, 5-10x timeout) are my own rules of thumb, not from the docs. Docker gives no general recommendations, only examples (Compose: 1m30s/10s/3/40s).
- Docs notes: a probe failure during `start_period` doesn't count toward `retries`, but a success ends the grace period and later failures count. The next probe is scheduled `interval` after the previous one completes. A probe that exceeds `timeout` counts as failed. `start_interval` (probe frequency during `start_period`) needs Docker Engine 25.0+.
- Sources: https://docs.docker.com/reference/dockerfile/#healthcheck and https://docs.docker.com/reference/compose-file/services/#healthcheck. The Dockerfile quotes were read through a summarizing fetch, so confirm the wording on the page if it matters.
- This repo (`docker-compose.yaml`): `db` uses 5s/3s/5/10s, which suits dev. `redis` uses 30s/10s/3/30s, which is slow for dev because Redis starts in under a second and `ping` returns in milliseconds. 5s/3s/5/5s would give faster feedback.

### Q: Where do notes live?

A: In `notes/`, as question-and-answer entries in this file.
