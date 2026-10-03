import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

type Candidate = {
  start_seconds: number;
  end_seconds: number;
  score: number;
  topic: string;
  category: string;
  title: string;
  description: string;
  hashtags: string[];
  hook: string;
  social_caption: string;
  transcript: string;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const transcriptionUrl = Deno.env.get('CLIPFORGE_TRANSCRIPTION_URL');
  const analysisUrl = Deno.env.get('CLIPFORGE_ANALYSIS_URL');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'server_not_configured' }, 503);
  if (!transcriptionUrl || !analysisUrl) return json({ error: 'AI processing provider not configured' }, 503);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'authentication_required' }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'authentication_required' }, 401);

  let videoId = '';
  try {
    const body = await request.json();
    videoId = typeof body.videoId === 'string' ? body.videoId : '';
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  if (!videoId) return json({ error: 'video_id_required' }, 400);

  const { data: video, error: videoError } = await userClient
    .from('videos')
    .select('id,owner_id,project_id,source_type,storage_path,source_url,processing_status,rights_confirmed')
    .eq('id', videoId)
    .eq('owner_id', user.id)
    .single();
  if (videoError || !video) return json({ error: 'video_not_found' }, 404);
  if (!video.rights_confirmed) return json({ error: 'content_rights_confirmation_required' }, 403);
  if (video.processing_status !== 'queued') return json({ error: 'video_not_queued' }, 409);

  let sourceUrl = video.source_url as string | null;
  if (video.source_type === 'upload' && video.storage_path) {
    const { data, error } = await userClient.storage.from('source-videos').createSignedUrl(video.storage_path, 3600);
    if (error || !data?.signedUrl) return json({ error: 'source_video_unavailable' }, 400);
    sourceUrl = data.signedUrl;
  }
  if (!sourceUrl) return json({ error: 'source_video_unavailable' }, 400);
  if (video.source_type === 'youtube' && !isYouTubeVideoUrl(sourceUrl)) return json({ error: 'invalid_youtube_url' }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await admin.from('videos').update({ processing_status: 'processing' }).eq('id', video.id).eq('owner_id', user.id);
  await admin.from('projects').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', video.project_id).eq('owner_id', user.id);

  EdgeRuntime.waitUntil(processVideo(admin, video, sourceUrl, user.id, transcriptionUrl, analysisUrl));
  return json({ status: 'processing', videoId: video.id, projectId: video.project_id }, 202);
});

function isYouTubeVideoUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be' || host === 'www.youtu.be') return url.pathname.split('/').filter(Boolean).length === 1;
    return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)
      && Boolean(url.searchParams.get('v') || url.pathname.match(/^\/(shorts|live|embed)\/[^/]+/));
  } catch {
    return false;
  }
}

async function callProvider(url: string, payload: unknown, secretName: string) {
  const key = Deno.env.get(secretName);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${secretName}_request_failed`);
  return await response.json();
}

async function processVideo(admin: ReturnType<typeof createClient>, video: Record<string, unknown>, sourceUrl: string, ownerId: string, transcriptionUrl: string, analysisUrl: string) {
  const videoId = String(video.id);
  const projectId = String(video.project_id);
  let insertedIds: string[] = [];
  try {
    const transcriptResult = await callProvider(transcriptionUrl, {
      video_url: sourceUrl,
      language: 'auto',
      word_timestamps: true,
    }, 'CLIPFORGE_TRANSCRIPTION_API_KEY');
    const transcript = typeof transcriptResult.transcript === 'string' ? transcriptResult.transcript.trim() : '';
    const durationSeconds = Number(transcriptResult.duration_seconds);
    if (!transcript || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('transcription_response_invalid');

    const selection = await callProvider(analysisUrl, {
      transcript,
      duration_seconds: durationSeconds,
      target_count: 10,
      minimum_count: 5,
      minimum_seconds: 40,
      maximum_seconds: 60,
      score_dimensions: ['hook_strength', 'content_value', 'context_completeness', 'clarity', 'ending_quality', 'short_form_fit'],
      categories: ['Educational', 'Funny', 'Emotional', 'Story', 'Business', 'Motivational', 'Interesting'],
      selection_rules: [
        'Select naturally bounded, self-contained moments; never divide the source into fixed intervals.',
        'Start at a sentence boundary with an immediate hook or useful context; end on a complete thought.',
        'Avoid filler, long silence, repetition, abrupt cuts, and moments that require missing context.',
        'Return fewer than five if the transcript does not contain five genuinely suitable moments.',
        'Every returned segment must be between 40 and 60 seconds and fit within the source duration.',
        'Score content potential only; never claim or imply guaranteed virality.',
      ],
      response_schema: {
        clips: [{ start_seconds: 'number', end_seconds: 'number', score: 'integer 0-100', topic: 'string', category: 'string', title: 'string', description: 'string', hashtags: ['string'], hook: 'string', social_caption: 'string', transcript: 'string' }],
      },
    }, 'CLIPFORGE_ANALYSIS_API_KEY');

    const candidates = validateCandidates(selection.clips, durationSeconds);
    if (candidates.length === 0) throw new Error('no_qualified_moments');
    const { data: clips, error: clipError } = await admin.from('clips').insert(candidates.map((clip) => ({
      owner_id: ownerId,
      project_id: projectId,
      video_id: videoId,
      start_seconds: clip.start_seconds,
      end_seconds: clip.end_seconds,
      ai_content_score: clip.score,
      topic: clip.topic,
      category: clip.category,
    }))).select('id');
    if (clipError || !clips) throw new Error('clip_persistence_failed');
    insertedIds = clips.map((clip) => clip.id);

    const metadataRows = candidates.map((clip, index) => ({
      owner_id: ownerId,
      clip_id: insertedIds[index],
      suggested_title: clip.title,
      description: clip.description,
      hashtags: clip.hashtags,
      hook: clip.hook,
      social_caption: clip.social_caption,
      transcript: clip.transcript,
    }));
    const { error: metadataError } = await admin.from('clip_metadata').insert(metadataRows);
    if (metadataError) throw new Error('metadata_persistence_failed');

    await admin.from('videos').update({ processing_status: 'ready', duration_seconds: Math.round(durationSeconds), failure_code: null }).eq('id', videoId).eq('owner_id', ownerId);
    await admin.from('projects').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', projectId).eq('owner_id', ownerId);
  } catch (error) {
    if (insertedIds.length) await admin.from('clips').delete().in('id', insertedIds).eq('owner_id', ownerId);
    await admin.from('videos').update({ processing_status: 'failed', failure_code: error instanceof Error ? error.message.slice(0, 80) : 'provider_failed' }).eq('id', videoId).eq('owner_id', ownerId);
    await admin.from('projects').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', projectId).eq('owner_id', ownerId);
  }
}

function validateCandidates(value: unknown, durationSeconds: number): Candidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).filter((item): item is Candidate => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<Candidate>;
    const start = Number(candidate.start_seconds);
    const end = Number(candidate.end_seconds);
    const score = Number(candidate.score);
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= durationSeconds
      && end - start >= 40 && end - start <= 60
      && Number.isInteger(score) && score >= 0 && score <= 100
      && typeof candidate.title === 'string' && Boolean(candidate.title.trim())
      && typeof candidate.topic === 'string' && typeof candidate.category === 'string'
      && typeof candidate.description === 'string' && typeof candidate.social_caption === 'string'
      && typeof candidate.hook === 'string' && typeof candidate.transcript === 'string';
  }).map((item) => ({
    ...item,
    topic: item.topic.slice(0, 80),
    category: ['Educational', 'Funny', 'Emotional', 'Story', 'Business', 'Motivational', 'Interesting'].includes(item.category) ? item.category : 'Interesting',
    title: item.title.slice(0, 180),
    description: item.description.slice(0, 1000),
    hashtags: Array.isArray(item.hashtags) ? item.hashtags.filter((tag) => typeof tag === 'string').slice(0, 12) : [],
    hook: item.hook.slice(0, 500),
    social_caption: item.social_caption.slice(0, 2000),
    transcript: item.transcript.slice(0, 12000),
  }));
}
