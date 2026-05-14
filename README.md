# D2C AI Employee - Node + Express

## Day 1 setup

### Prerequisites
- Node.js 20+
- Docker Desktop running

### Steps

```bash
# 1. Copy env and fill in your keys
cp .env.example .env

# 2. Start Postgres + Redis
docker compose up postgres redis -d

# 3. Install all workspace dependencies
npm install

# 4. Generate the migration SQL from schema.ts
npm run db:generate

# 5. Apply migrations to Postgres
npm run db:migrate

# 6. Seed two dev merchants
npm run -w packages/backend db:seed

# 7. Start the API (hot reload)
npm run dev:api
```

Visit http://localhost:3000/health

---

## Project structure

```
d2c-ai-employee/
├── docker-compose.yml
├── .env.example
├── package.json              <- npm workspaces root
├── tsconfig.json             <- project references
└── packages/
    ├── backend/
    │   ├── src/
    │   │   ├── server.ts         <- Express app entry
    │   │   ├── worker.ts         <- BullMQ worker entry
    │   │   ├── core/config.ts    <- Zod-validated env
    │   │   ├── db/
    │   │   │   ├── schema.ts     <- Drizzle table definitions
    │   │   │   ├── index.ts      <- DB client singleton
    │   │   │   ├── migrate.ts    <- Run migrations
    │   │   │   └── seed.ts       <- Dev data seed
    │   │   ├── api/routes/       <- Express routers (Day 4-6)
    │   │   ├── connectors/       <- Connector implementations (Day 2-3)
    │   │   └── agents/           <- RTO agent (Day 5)
    │   ├── drizzle.config.ts
    │   └── tsconfig.json
    ├── frontend/                 <- React + Vite (Day 6)
    └── shared/src/index.ts       <- Shared TypeScript types
```

## Useful commands

| Command | What it does |
|---|---|
| npm run dev:api | Start API with hot reload |
| npm run dev:worker | Start BullMQ worker |
| npm run db:generate | Generate migration from schema changes |
| npm run db:migrate | Apply pending migrations |
| npm run db:studio | Open Drizzle Studio visual browser |
| npm run typecheck | Type-check all packages |
