# Jaguar Math

Jaguar Math is a Grade 11–12 assessment platform for teachers and students. It supports assignment authoring, automatic grading, progress analytics, Exam Mode, CSV result exports, student credential management, and Google Classroom roster sync.

## Stack

- Next.js 16 App Router, React 19, and TypeScript
- Supabase Auth and PostgreSQL with row-level security
- KaTeX for mathematical notation
- Google Classroom and Gmail APIs for roster sync and credential delivery

## Prerequisites

- Node.js 20.9 or newer
- npm
- A Supabase project, or the Supabase CLI for local development
- Optional: a Google Cloud OAuth client for Classroom sync

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local`:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
   SUPABASE_SECRET_KEY=
   NEXT_PUBLIC_APP_URL=http://localhost:3000

   # Optional Google Classroom integration
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
   ```

   Keep `SUPABASE_SECRET_KEY` and `GOOGLE_CLIENT_SECRET` server-only. For a local Supabase instance, the corresponding local anon and service-role keys can be used.

3. Apply the database migrations and seed data. With a local Supabase instance:

   ```bash
   npx supabase start
   npx supabase db reset
   ```

   For a linked hosted project, use `npx supabase db push --include-seed` instead.

4. Create an Auth user for the teacher, then promote the matching profile in the Supabase SQL editor:

   ```sql
   update public.profiles
   set role = 'teacher'
   where email = 'teacher@example.com';
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Google Classroom setup

Create a Google OAuth web client and enable the Google Classroom and Gmail APIs. Add the value of `GOOGLE_REDIRECT_URI` as an authorized redirect URI. The app requests read-only course, roster, email, and photo access plus `gmail.send`; teachers must reconnect if those scopes change.

In production, set `NEXT_PUBLIC_APP_URL` and `GOOGLE_REDIRECT_URI` to the deployed HTTPS origin.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the development server |
| `npm run lint` | Run ESLint |
| `npm run build` | Type-check and create a production build |
| `npm run start` | Serve the production build |
| `npm run validate:skills` | Validate taxonomy data and regenerate `supabase/seed.sql` |

## Project structure

- `app/` — routes, Server Actions, and UI
- `lib/` — authentication, Supabase clients, taxonomy analytics, and Google integrations
- `data/` — skill and framework taxonomy sources
- `supabase/migrations/` — schema, RLS policies, and transactional database functions
- `supabase/seed.sql` — generated skill and framework seed data
- `scripts/generate-skill-seed.mjs` — taxonomy validator and seed generator

## Deployment

Deploy the Next.js app to Vercel or another Node.js host, configure every required environment variable, and apply Supabase migrations before releasing application code that depends on them. Never expose the Supabase secret key or Google client secret as public environment variables.
