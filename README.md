# Calman

Counselling CRM for Zeroinfy — replaces the "Zeroinfy Calman Calling" Google Sheet.

Full specification: [`docs/calman-spec.md`](docs/calman-spec.md).

## Stack

Next.js 16 (App Router, TypeScript, Tailwind v4) · Supabase (Postgres, Auth, RLS) · Vercel.
Deployment target `calman.zeroinfy.in`; Supabase project in Mumbai.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the Supabase keys
npm run dev
```

Environment variables:

| Name | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Bare project origin, no path |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | RLS is what protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Bypasses RLS — never expose |

## Layout

```
app/                Next.js App Router
lib/supabase/       client.ts (browser) · server.ts (RSC/actions)
                    admin.ts (service role, server-only) · middleware.ts (session refresh)
proxy.ts            Next 16 middleware entrypoint — refreshes the Supabase session
supabase/migrations SQL migrations
types/database.ts   Generated Supabase types
docs/               Specification
```
