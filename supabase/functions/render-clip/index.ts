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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rendererUrl = Deno.env.get('CLIPFORGE_RENDER_URL');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'server_not_configured' }, 503);
  if (!rendererUrl) return json({ error: 'Video rendering provider not configured' }, 503);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'authentication_required' }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'authentication_required' }, 401);

  let input: { clipId?: string; resolution?: string; aspectRatio?: string; captions?: boolean; startSeconds?: number; endSeconds?: number };
  try {
    input = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  if (!input.clipId || !['720p', '1080p'].includes(input.resolution ?? '') || !['9:16', '16:9', '1:1'].includes(input.aspectRatio ?? '')) {
    return json({ error: 'invalid_export_options' }, 400);
  }

  const { data: clip, error: clipError } = await userClient
    .from('clips')
    .select('id,owner_id,video_id,start_seconds,end_seconds')
    .eq('id', input.clipId)
    .eq('owner_id', user.id)
    .single();
  if (clipError || !clip) return json({ error: 'clip_not_found' }, 404);
  const startSeconds = input.startSeconds ?? Number(clip.start_seconds);
  const endSeconds = input.endSeconds ?? Number(clip.end_seconds);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
    || startSeconds < Number(clip.start_seconds) || endSeconds > Number(clip.end_seconds)
    || endSeconds <= startSeconds || endSeconds - startSeconds > 60) {
    return json({ error: 'invalid_trim_bounds' }, 400);
  }

  const { data: video, error: videoError } = await userClient
    .from('videos')
    .select('id,source_type,source_url,storage_path')
    .eq('id', clip.video_id)
    .eq('owner_id', user.id)
    .single();
  if (videoError || !video) return json({ error: 'source_video_not_found' }, 404);

  let sourceUrl = video.source_url as string | null;
  if (video.source_type === 'upload' && video.storage_path) {
    const { data, error } = await userClient.storage.from('source-videos').createSignedUrl(video.storage_path, 3600);
    if (error || !data?.signedUrl) return json({ error: 'source_video_unavailable' }, 400);
    sourceUrl = data.signedUrl;
  }
  if (!sourceUrl) return json({ error: 'source_video_unavailable' }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: exportRow, error: exportError } = await admin.from('exports').insert({
    owner_id: user.id,
    clip_id: clip.id,
    format: 'mp4',
    resolution: input.resolution,
    status: 'rendering',
  }).select('id').single();
  if (exportError || !exportRow) return json({ error: 'export_record_failed' }, 500);

  const storagePath = `${user.id}/${exportRow.id}.mp4`;
  const { data: destination, error: destinationError } = await userClient.storage.from('clip-exports').createSignedUploadUrl(storagePath);
  if (destinationError || !destination?.signedUrl) {
    await admin.from('exports').update({ status: 'failed', failure_code: 'destination_unavailable' }).eq('id', exportRow.id);
    return json({ error: 'export_destination_unavailable' }, 500);
  }

  EdgeRuntime.waitUntil(renderClip({
    admin,
    exportId: exportRow.id,
    ownerId: user.id,
    rendererUrl,
    sourceUrl,
    destinationUrl: destination.signedUrl,
    startSeconds,
    endSeconds,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    captions: input.captions === true,
    storagePath,
  }));
  return json({ exportId: exportRow.id, status: 'rendering' }, 202);
});

async function renderClip(input: {
  admin: ReturnType<typeof createClient>;
  exportId: string;
  ownerId: string;
  rendererUrl: string;
  sourceUrl: string;
  destinationUrl: string;
  startSeconds: number;
  endSeconds: number;
  resolution: string;
  aspectRatio: string;
  captions: boolean;
  storagePath: string;
}) {
  try {
    const key = Deno.env.get('CLIPFORGE_RENDER_API_KEY');
    const response = await fetch(input.rendererUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        source_video_url: input.sourceUrl,
        output_upload_url: input.destinationUrl,
        start_seconds: input.startSeconds,
        end_seconds: input.endSeconds,
        format: 'mp4',
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
        captions: input.captions,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error('renderer_request_failed');
    const result = await response.json();
    if (result.status !== 'ready') throw new Error('renderer_did_not_confirm_upload');
    await input.admin.from('exports').update({ status: 'ready', storage_path: input.storagePath }).eq('id', input.exportId).eq('owner_id', input.ownerId);
  } catch (error) {
    await input.admin.from('exports').update({
      status: 'failed',
      failure_code: error instanceof Error ? error.message.slice(0, 80) : 'renderer_failed',
    }).eq('id', input.exportId).eq('owner_id', input.ownerId);
  }
}
