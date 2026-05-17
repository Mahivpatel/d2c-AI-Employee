# D2C AI Employee Project Guide

This document is the practical runbook for the project. Use it when you want to run the app locally, understand the moving parts, seed data, sync connectors, or verify the code.

## Prerequisites

- Node.js 20+
- npm
- Docker Desktop, for Postgres and Redis
- A Groq API key if you want chat responses to work

## Project Layout

```text
d2c-node/
|-- mock_data/
|   |-- meta_ads/          # Meta Ads mock API payloads
|   `-- shiprocket/        # Shiprocket mock API payloads
|-- packages/
|   |-- backend/           # Express API, connectors, agents, DB, chat tools
|   |-- frontend/          # React + Vite dashboard
|   `-- shared/            # Shared workspace package
|-- scripts/               # Utility scripts for generated mock data
|-- docker-compose.yml     # Postgres, Redis, API, worker services
|-- package.json           # Root npm workspace scripts
`-- README.md              # Product/architecture overview
```

## Environment Setup

Create a local `.env` file from the example:

```bash
cp .env.example .env
```

If you run Postgres from `docker-compose.yml`, use this database URL in `.env`:

```text
DATABASE_URL=postgresql://d2c:d2c_secret@localhost:5433/d2c_ai
REDIS_URL=redis://localhost:6379
```

For mock connector mode, these values are enough:

```text
META_MODE=mock
META_MOCK_DATA_PATH=mock_data/meta_ads
SHIPROCKET_MODE=mock
SHIPROCKET_MOCK_DATA_PATH=mock_data/shiprocket
```

For chat, set:

```text
GROQ_API_KEY=your-groq-key
```

## Run Locally

Install dependencies:

```bash
npm install
```

Start Postgres and Redis:

```bash
docker compose up postgres redis -d
```

Generate and apply database migrations:

```bash
npm run db:generate
npm run db:migrate
```

Seed demo merchants:

```bash
npm run -w packages/backend db:seed
```

Start the API:

```bash
npm run dev:api
```

Start the frontend in a second terminal:

```bash
npm run dev:web
```

Optional: start the worker in a third terminal:

```bash
npm run dev:worker
```

Open the app:

```text
Frontend: http://localhost:5173
API:      http://localhost:3000
Health:   http://localhost:3000/health
```

The Vite frontend proxies `/api` requests to `http://localhost:3000`.

## Useful Commands

```bash
npm run dev:api       # Start Express API with tsx watch
npm run dev:web       # Start React/Vite frontend
npm run dev:worker    # Start BullMQ worker and agent schedulers
npm run db:generate   # Generate Drizzle migration files
npm run db:migrate    # Apply migrations
npm run db:studio     # Open Drizzle Studio
npm run typecheck     # Type-check all workspaces
npm run -w packages/backend test       # Run backend tests
npm run -w packages/backend db:seed    # Seed demo merchants
```

## Sync Data

The sync endpoint fetches normalized facts from a connector and writes them into the `facts` table.

```http
POST /api/sync
```

Example:

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "replace-with-merchant-uuid",
    "connector": "meta_ads",
    "entity": "ad_insights",
    "filters": {
      "limit": 100
    }
  }'
```

Supported connectors:

- `shopify`
- `meta_ads`
- `shiprocket`

Common mock entities:

- Meta Ads: `campaigns`, `ad_sets`, `ads`, `ad_insights`
- Shiprocket: `shipments`, `tracking_history`, `ndr_events`, `rto_events`

## API Surface

```text
GET  /health
GET  /api/merchants
POST /api/merchants
GET  /api/merchants/:id
POST /api/sync
POST /api/sync/write
GET  /api/metrics?merchantId=...&periodDays=7
GET  /api/agents?merchantId=...&status=pending_review
POST /api/agents/dead-stock/trigger
POST /api/agents/:id/approve
POST /api/agents/:id/dismiss
POST /api/chat
GET  /api/chat/stream?merchantId=...&message=...
```

## Technical Architecture

### Backend

The backend is a Node.js and Express service in `packages/backend`.

Core responsibilities:

- Validate environment variables with Zod in `src/core/config.ts`
- Expose REST routes from `src/api/routes`
- Normalize connector data into a universal `facts` table
- Run chat tools over normalized business data
- Store agent proposals for human approval
- Run workers and scheduled jobs with BullMQ and Redis

### Frontend

The frontend is a React + Vite app in `packages/frontend`.

Main views:

- Metrics dashboard
- Chat interface with streaming SSE responses
- Agent inbox for reviewing proposed actions

API calls live in `packages/frontend/src/api/client.ts`. During local development, Vite proxies `/api` to the backend.

### Database

The project uses PostgreSQL with Drizzle ORM.

Important tables:

- `merchants`: tenant records
- `facts`: normalized facts from Shopify, Meta Ads, and Shiprocket
- `sync_logs`: connector sync status and audit history
- `agent_runs`: autonomous agent proposals and review state

The `facts` table is tenant-safe. Upsert deduplication uses:

```text
merchant_id + source + raw_id
```

This prevents two merchants with the same source record ID from overwriting each other.

### Connectors

Connectors implement the `BaseConnector` contract:

```text
authenticate()
fetch(entity, filters)
schema()
write(entity, payload)
```

Every connector returns `NormalizedFact[]`, so the rest of the system does not need to know whether the source was Shopify, Meta Ads, or Shiprocket.

Current connectors:

- `ShopifyConnector`
- `MetaAdsConnector`
- `ShiprocketConnector`

Meta Ads and Shiprocket can run in mock mode using JSON files under `mock_data/`.

### Chat And Citations

Chat runs through the Vercel AI SDK with Groq as the configured provider. The chat layer exposes bounded tools instead of giving the model raw database access.

Tool examples:

- Shopify revenue analysis
- Product performance
- Order detail lookup
- Shiprocket shipment lookup
- Shiprocket event queries
- Meta Ads performance queries

Responses are checked by the citation verifier so numerical claims must be grounded in tool results.

### Worker And Agent Flow

The worker process runs BullMQ workers and registers the dead stock scheduler for active merchants.

The Dead Stock Agent:

1. Reads normalized inventory and sales signals.
2. Calculates slow-moving inventory risk.
3. Writes proposals to `agent_runs`.
4. Waits for human approval or dismissal.
5. Only executes connector writes through `/api/sync/write` after approval.

## Verification Checklist

After setup, a healthy local run should pass these checks:

```bash
curl http://localhost:3000/health
npm run typecheck
npm run -w packages/backend test
```

Then open:

```text
http://localhost:5173
```

If the dashboard is empty, seed merchants first and run connector syncs for the selected merchant.

## Common Issues

### Database connection fails

Check that Docker is running and that `.env` uses port `5433` when connecting from your host machine:

```text
DATABASE_URL=postgresql://d2c:d2c_secret@localhost:5433/d2c_ai
```

### Chat fails

Make sure `GROQ_API_KEY` is set. The chat provider throws an error when no LLM key is configured.

### Frontend API calls fail

Make sure the backend is running on port `3000`. The frontend dev server expects that target for `/api` proxying.

### Sync returns no data

Confirm the connector is in mock mode and the mock data path exists:

```text
META_MODE=mock
META_MOCK_DATA_PATH=mock_data/meta_ads
SHIPROCKET_MODE=mock
SHIPROCKET_MOCK_DATA_PATH=mock_data/shiprocket
```
