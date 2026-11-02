# Q&A Log

Grouped by branch, newest branch first. Each branch section has a heading with the branch name and a one-line summary.

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
