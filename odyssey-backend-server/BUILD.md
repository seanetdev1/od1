# Building the sealed backend

`build/build-backend.js` and `build/seal-tree.js` both reference this file.
It covers assembling something shippable from their output. For the licensing
side — keys, the licence server, what the kill-switch does, and the pre-lease
checklist — see [`../BUILD-AND-LICENSING.md`](../BUILD-AND-LICENSING.md).

## Two pipelines, two shapes

There are two build scripts and they produce different things. Pick one.

| | `npm run build` (`build-backend.js`) | `npm run seal` (`seal-tree.js`) |
|---|---|---|
| Output | One bundled `app.jsc` | A mirror of the source tree, every `.js` → `.jsc` |
| Steps | esbuild bundle → obfuscate → bytenode | bytenode per file |
| Launcher | `build/dist/server.js` | `build/dist/run.js` |
| Used by | Manual/SEA distribution | **The Dockerfile** |
| Readable source in output | none | none |

The Docker image uses `seal-tree.js`. If you change the build and only test
`npm run build`, you have not tested what ships.

## Prerequisites

```bash
npm install          # dev deps included - esbuild, javascript-obfuscator, bytenode
```

Bytecode is tied to the **V8 version that produced it**. Compile on the same
Node major version the target runs (currently Node 22, per the Dockerfile).
A `.jsc` built on Node 20 will not load on Node 22.

## Option A — Docker (what customers get)

```bash
docker compose up -d --build
```

Everything below is handled inside the image: `seal-tree.js` runs in the
builder stage, prod-only `node_modules` come from a separate stage, and the
runtime stage gets Chromium for invoice PDFs. Nothing to assemble by hand.

## Option B — assemble a folder manually

```bash
npm run build        # -> build/dist/app.jsc + server.js
```

Then lay out:

```
odyssey-server/
  server.js            <- from build/dist/ (launcher)
  app.jsc              <- from build/dist/ (sealed code)
  node_modules/        <- npm ci --omit=dev
  models/  config/     <- see "What must stay readable" below
  .env                 <- PER-INSTALL, never shared between customers
```

Run it:

```bash
node server.js
```

### What must stay readable

- **`config/config.js`** — Sequelize reads it at runtime. It contains no
  secrets: credentials come from `DB_USER`/`DB_PASS`/`DB_NAME` or from
  `DATABASE_URL` in the environment. (It replaced `config/config.json`, which
  had a literal password in it and is now gitignored so a stale copy can't
  come back.)
- **`node_modules/`** — public npm packages. Nothing proprietary; sealing them
  buys nothing and breaks native modules.
- **The launcher** (`server.js` / `run.js`) — plain JS by design, no logic in it.

### Puppeteer / Chromium

Invoice PDF rendering shells out to Chromium, which cannot live inside a
bytecode file or a single executable. Either ship puppeteer's Chromium folder
next to `node_modules`, or set `PUPPETEER_EXECUTABLE_PATH` to a browser already
installed on the target. **Test invoice printing on the actual target box** —
this is the step that most often fails after a clean install.

## Required environment

The backend refuses to boot without a per-install `JWT_SECRET`
(`functions/secrets.js`) — deliberately, so no two installs share a
token-signing key. See `.env.example` for the full list;
`../BUILD-AND-LICENSING.md` §7 is the pre-lease checklist.

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Entry points and clustering

| Command | Processes | Notes |
|---|---|---|
| `node run.js` | 1 | Sealed build. What the Docker image runs. |
| `npm run start` | one per CPU | `node server.js -p 8088`. From source. |
| `npm run start:prod` | one per CPU | The same with NODE_ENV=production. |
| `npm run dev` | 1 | `nodemon index.js`. Development only. |
| `npm run start:single` | 1 | `node index.js -p 8088`. One process, from source. |

`server.js` runs the schema sync in the primary and waits for it before
forking; workers skip it (`models/index.js` checks `cluster.isWorker`). Sessions
are stored in Postgres, so logout and single-session enforcement hold across
workers. Both of those had to be true before clustering was safe to enable —
if you touch either, re-read `functions/sessionManager.js` first.

## Verifying a build

```bash
npm test                              # unit + integration (needs a local Postgres)
node -e "require('./build/dist/index.jsc')"   # bytecode actually loads
```

A build that compiles but whose `.jsc` won't load on the target's Node version
is the classic failure here — check it before shipping, not after.
