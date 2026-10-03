# Clipy

A responsive React and TypeScript foundation for an AI-assisted long-form video repurposing workspace. The UI includes a demo dashboard, local project management, upload and YouTube URL validation, sample clip review, metadata controls, and an editor interaction prototype.

## Important status

The sample project and clip cards are illustrative demo data; they were not created from a user's video. Analysis, transcription, AI clip selection, preview rendering, and export are not connected and must not be treated as working services. Submitting a valid video or URL reports that processing is unavailable and does not upload, fetch, or analyze the media. YouTube access restrictions are not bypassed.

Authentication, database, and private storage use Supabase integration points. Supply a Supabase project and configure its schema before enabling persisted accounts or uploads. No payment processing is included.

## Local development

Requirements: Node.js 20.19+ or 22.12+, with npm.

1. Copy `.env.example` to `.env.local` and set `VITE_MAX_UPLOAD_MB` as needed. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only when connecting your Supabase project. The browser key must be the public anon key; never use a service-role key here.
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.
4. Check the production TypeScript build with `npm run build`.

## Supabase setup

Apply `supabase/migrations/202609250001_initial_schema.sql` to a new Supabase project. It creates owner-scoped tables and RLS policies, plus a private `source-videos` bucket. Configure email authentication in the Supabase dashboard. The public browser key is safe only alongside the migration's RLS policies and appropriate storage policies.

The Supabase client and auth/storage helpers live in `src/lib/providers.ts`. Project and clip edits currently live in browser memory and are not persisted to Supabase.

## Processing integrations

Implement `TranscriptionProvider`, `MomentAnalysisProvider`, and `VideoRenderingProvider` in `src/lib/providers.ts` or server-side adapters. Keep provider secrets on a trusted server or edge function, never in `VITE_*` variables. A moment-analysis implementation should return self-contained segments based on transcript boundaries, context, hook, value, and ending quality, not fixed time slicing. Connect the UI's `startVideoAnalysis` and export actions only after those server endpoints exist and can report explicit failure states.

For uploads, use the private `source-videos` bucket and user-scoped object paths. Do not fetch restricted YouTube media or bypass authentication, DRM, or other access controls; ask users to upload media they have permission to process.
