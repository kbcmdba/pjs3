# Personal Job Seeker 3 (PJS3)

A multi-tenant web app for tracking your job search — companies, contacts, job applications, searches, and notes — with shareable workspaces so a partner or mentor can see your progress without getting their own data mixed in.

PJS3 is the Node.js successor to [PJS2](https://github.com/kbcmdba/pjs2) (PHP). The "PJS" acronym has been rebranded from "PHP Job Seeker" to "Personal Job Seeker."

## Status

**Early development.** The walking skeleton is in place and the project is being built test-first. Scope, stack, and the first-TDD-target sequence live in [MVP_SCOPE.md](MVP_SCOPE.md); read that before contributing.

The commit history is intentionally a learning artifact — including the failing-test commits and the fix-ups. Pull requests are welcome; see [Contributing](#contributing) below.

## Prerequisites

- **Node.js 22+** (LTS)
- **MySQL 8** (required for the database layer — not yet wired up, but pinned as the choice)
- **Git**

## Quick Start

```sh
git clone https://github.com/kbcmdba/pjs3.git
cd pjs3/api
npm install
npm test
```

The current test suite exercises a `GET /health` endpoint via Fastify's in-process `inject()` — no real server or database needed yet.

To run the dev server:

```sh
npm run dev
```

Listens on port **8443** by default. Override via env vars (see `api/.env.example`):

```sh
PORT=9000 HOST=127.0.0.1 npm run dev
```

## Repository Layout

```
pjs3/
├── api/              Backend (Fastify + Vitest + TypeScript)
├── MVP_SCOPE.md      Initial-release scope, committed stack, open questions
├── LICENSE           GPLv2
└── README.md         This file
```

A `web/` frontend (React + Vite) will land alongside `api/` once the backend has enough to show. No npm workspaces — each subdirectory is independent until shared code actually emerges.

## Contributing

PJS3 is developed in the open and welcomes pull requests. Two things to know before opening one:

1. **TDD is mandatory.** Any change to production code must be accompanied by a test. Bug fixes start with a test that reproduces the bug.
2. **PRs get two reviewers** — the author (@kbcmdba) and the Claude Code collaborator working on the project — before merge. Expect substantive review, not a rubber stamp.

The commit history will show you what the TDD rhythm looks like in practice (`... (TDD red step)` / `... (TDD green step)` subjects). Follow that shape for your own contributions.

## License

[GPL-2.0-only](LICENSE).
