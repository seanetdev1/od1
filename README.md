# Odyssey Monorepo

One central, independently cloneable repository containing the complete **Odyssey** frontend (`odyssey-front-end/`) and backend (`odyssey-backend-server/`) source code as normal folders (no Git submodules), with safe upstream synchronization and a one-command development environment.

---

## Repository Layout

- `odyssey-front-end/` — Next.js frontend (synced from `https://github.com/Bilal-Seanet/odyssey-front-end.git`)
- `odyssey-backend-server/` — Express + Sequelize backend (synced from `https://github.com/Bilal-Seanet/odyssey-backend-server.git`)
- `docker-compose.yml` — PostgreSQL 17 container with persistent volume (`odyssey_pgdata`) and automatic database initialization (no pgAdmin required)
- `database/init/` — Automatic PostgreSQL initialization script (creates main & test databases on first start)
- `odyssey.bat` — One-command launcher (syncs upstream, starts PostgreSQL, verifies/syncs schema, installs dependencies, starts backend & frontend)
- `update-all.bat` — Safe one-command upstream sync using `git subtree` (never discards uncommitted work; pushing to upstream repos is disabled)
- `db-backup.bat` / `db-restore.bat` — Verified PostgreSQL custom-format backup & confirmed restore scripts (works with both Docker Compose and local PostgreSQL)

---

## Fresh Clone Setup

1. **Clone the repository:**
   ```powershell
   git clone <your-monorepo-url>
   cd <repo-folder>
   ```

2. **Create environment files (never committed):**
   - Copy `.env.example` to `.env` (used by `docker-compose.yml`) and set `DB_PASS`.
   - Copy `odyssey-backend-server\.env.example` (or `.env.example`) to `odyssey-backend-server\.env` and set `DB_PASS` and a unique `JWT_SECRET`:
     ```powershell
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```

3. **Run Odyssey with one command:**
   ```powershell
   odyssey.bat
   ```
   - **Default (`--dev`)**: Hot-reload mode — Frontend at `http://localhost:3000`, Backend at `http://localhost:8084`
   - **Production build (`--prod`)**: Builds and starts Frontend at `http://localhost:3003`, Backend at `http://localhost:8088`

---

## Common Commands

| Command | Description |
|---|---|
| `odyssey.bat` | Sync upstream (if clean), start PostgreSQL, verify/sync DB schema, start dev servers (`3000` / `8084`) |
| `odyssey.bat --prod` | Build and start production servers (`3003` / `8088`) |
| `odyssey.bat --skip-update` | Start immediately without fetching upstream repos |
| `odyssey.bat --migrate-alter` | Reconcile schema column drift (`ODYSSEY_DB_SYNC=alter`) before starting |
| `odyssey.bat --status` | Show PostgreSQL, backend, and frontend status |
| `odyssey.bat --stop` | Safely stop running Odyssey processes |
| `update-all.bat` | Safely pull latest `main` from both original GitHub repos via `git subtree` |
| `db-backup.bat` | Create and verify a timestamped `.dump` backup in `backups/` |
| `db-restore.bat` | Interactively restore a backup (requires `RESTORE` confirmation and creates a pre-restore safety backup) |

---

## PostgreSQL & Docker Compose

- **With Docker Desktop installed:** `odyssey.bat` automatically runs `docker compose up -d postgres`, stores data persistently in the `odyssey_pgdata` Docker volume, and creates both `DB_NAME` and `DB_NAME_TEST` on first boot.
- **With local PostgreSQL installed (e.g., PostgreSQL 17 service):** If a local PostgreSQL service is already running on `DB_PORT`, the scripts automatically use it without port conflicts or touching existing databases.
- **No pgAdmin required:** All initialization, schema sync, backup, and restore operations run directly via scripts.

---

## Upstream Synchronization Safety

- Upstream remotes (`upstream-frontend` and `upstream-backend`) are automatically configured by `update-all.bat` with `pushurl = DISABLED`, preventing accidental pushes to the original repositories.
- `update-all.bat` refuses to pull if you have uncommitted local edits — it never runs `git reset --hard` or `git clean -fd`.
