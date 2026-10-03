# Clipy Workspace Notes

- This is a React 19, TypeScript, Vite, and Tailwind CSS v4 application.
- Keep sample project and clip content explicitly labeled as demo data. Never represent it as output from actual user video.
- Processing is unavailable until real transcription, moment-analysis, and rendering providers are implemented behind `src/lib/providers.ts` interfaces.
- Supabase configuration uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; never put service-role secrets in frontend code.
- Update the SQL migration in `supabase/migrations` when changing persisted data or access rules. Keep Row Level Security enabled and owner-scoped.
- Run `npm run build` after code changes. See `README.md` for local setup and integration boundaries.
