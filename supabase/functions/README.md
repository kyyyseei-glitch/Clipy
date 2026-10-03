# Supabase Edge Function Contracts

Deploy `process-video` and `render-clip` with JWT verification enabled. Both functions validate the caller and confirm row ownership before queueing work. Set secrets with `supabase secrets set`; never place provider keys in `VITE_*` browser variables.

## Processing

Required secrets:

- `CLIPFORGE_TRANSCRIPTION_URL`
- `CLIPFORGE_ANALYSIS_URL`
- `CLIPFORGE_TRANSCRIPTION_API_KEY` (optional for private-network/self-hosted endpoints)
- `CLIPFORGE_ANALYSIS_API_KEY` (optional for private-network/self-hosted endpoints)

The transcription endpoint receives `POST { video_url, language: "auto", word_timestamps: true }` and returns `{ transcript, duration_seconds }`. The analysis endpoint receives a transcript, duration, score dimensions, and selection rules; return `{ clips: [...] }` with `start_seconds`, `end_seconds`, `score`, `topic`, `title`, `description`, `hashtags`, `hook`, `social_caption`, and `transcript`. The function rejects clips outside 40–60 seconds, outside the video, or with invalid scores. It stores valid clip rows and metadata, then updates the video/project status. It returns fewer than five when the provider finds fewer valid self-contained moments; it never fills the quota with arbitrary cuts.

YouTube URLs are passed to the configured transcription provider as URLs. ClipForge does not download, scrape, authenticate to, or bypass access controls on YouTube. Configure only a provider with lawful access to content users are authorized to process; otherwise ask the user to upload their source file.

## Rendering

Required secret: `CLIPFORGE_RENDER_URL`. Optional secret: `CLIPFORGE_RENDER_API_KEY`.

The renderer receives `source_video_url`, a short-lived private `output_upload_url`, trim bounds, aspect ratio, captions, and resolution. It must render the MP4 and upload it with HTTP `PUT` to the supplied signed URL before returning `{ "status": "ready" }`. The function then marks the export ready; the client creates a short-lived signed download URL. Long-running render APIs should be wrapped with a queue/worker adapter that preserves this contract and updates `exports` only after the upload completes.

## Deploy

Apply the SQL migration first, then deploy both functions. Configure provider secrets in the Supabase project. The frontend only reports completion after polling the persisted status; it does not fabricate processing progress.
