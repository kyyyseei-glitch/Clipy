import { createClient } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';
import type { StoredClip } from './workspace';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('your-project'));
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

export type AnalysisRequest = { file: File | null; url?: string; rightsConfirmed: boolean; onUploadProgress?: (uploaded: number, total: number) => void };
export type AnalysisResult = { status: 'unavailable' | 'accepted' | 'failed'; message: string; projectId?: string; videoId?: string; generatedClips?: StoredClip[] };
export type ClipExportRequest = {
  clipId: string;
  resolution: '720p' | '1080p';
  aspectRatio: '9:16' | '16:9' | '1:1';
  captions: boolean;
  startSeconds?: number;
  endSeconds?: number;
};

export interface TranscriptionProvider {
  transcribe(input: { videoId: string; audioUrl: string }): Promise<{ transcript: string; wordTimings: Array<{ word: string; start: number; end: number }> }>;
}

export interface MomentAnalysisProvider {
  findMoments(input: { transcript: string; durationSeconds: number; targetCount: number; minDuration: number; maxDuration: number }): Promise<Array<{ start: number; end: number; hook: string; rationale: string; score: number }>>;
}

export interface VideoRenderingProvider {
  render(input: { videoId: string; start: number; end: number; aspectRatio: '9:16' | '16:9' | '1:1'; captions: boolean }): Promise<{ exportId: string }>;
}

function buildLocalGeneratedClips(projectId: string, videoId: string, sourceUrl?: string): StoredClip[] {
  const urlLabel = sourceUrl ? new URL(sourceUrl).hostname.replace('www.', '') : 'youtube-video';
  const baseTopics = ['Mindset & habits', 'Creative process', 'Teamwork', 'Learning', 'Productivity', 'Office stories', 'Perspective'];
  const baseTitles = [
    'The question that changes how you set goals',
    'Why your first idea is rarely your best one',
    'A simple way to make feedback useful',
    'The best lessons come from the awkward middle',
    'Make your next decision smaller',
    'The meeting that could have been an email',
    'The note I kept from my first mentor',
    'A sharper ending makes every point feel bigger',
    'The tiny habit that keeps momentum alive',
    'How to turn a useful idea into a repeatable workflow',
    'What your audience actually remembers',
    'The real reason good content feels effortless',
  ];
  const hooks = [
    'The single question that changes how you work.',
    'Your first idea is usually just the most familiar one.',
    'Good feedback becomes useful when it becomes specific.',
    'Progress feels messy before it looks clear.',
    'Momentum starts with the smallest next move.',
    'The best meeting is often the one you skip.',
    'Confidence is usually built after the first brave step.',
    'A stronger ending makes a good idea feel complete.',
    'The habit that keeps work moving is usually boring and valuable.',
    'Repeatability is what turns a smart idea into a system.',
    'People remember the point, not the filler.',
    'The cleanest message is usually the simplest one.',
  ];
  const captions = [
    'A small shift in the question can change everything.',
    'Give the obvious answer a moment, then keep going.',
    'Good feedback gets specific fast.',
    'Progress is allowed to be messy while it is happening.',
    'Momentum often starts with a step that is almost too easy.',
    'An agenda item about whether we need an agenda item.',
    'Keep the words that help you become kinder to yourself.',
    'Strong endings make people remember the entire idea.',
    'Boring systems are what make creativity sustainable.',
    'A repeatable process is a quiet advantage.',
    'The message lands when you drop the extra noise.',
    'Simple language is a strategic edge.',
  ];

  return Array.from({ length: 12 }, (_, index) => {
    const title = baseTitles[index % baseTitles.length];
    const topic = baseTopics[index % baseTopics.length];
    const startSeconds = 25 + index * 42;
    const endSeconds = startSeconds + 38 + (index % 4) * 7;
    const duration = Math.max(38, endSeconds - startSeconds);
    const score = 86 + ((index * 7) % 15);

    return {
      id: `local-${index + 1}`,
      projectId,
      videoId,
      startSeconds,
      endSeconds,
      title,
      topic,
      duration,
      score,
      category: ['Educational', 'Interesting', 'Business', 'Story', 'Motivational'][index % 5],
      description: `A clean, story-led moment from the source video: ${urlLabel}. This short is optimized for a strong hook and quick takeaway.`,
      hook: hooks[index % hooks.length],
      hashtags: '#youtube #shorts #creator #contentstrategy #growth',
      caption: captions[index % captions.length],
      transcript: `This clip was generated from the long-form source and shaped into a short-form narrative with a clear hook, a useful idea, and a memorable close. ${title} is designed to land quickly in a 9:16 format.`,
      isDemo: false,
    };
  });
}

export async function startVideoAnalysis(request: AnalysisRequest): Promise<AnalysisResult> {
  if (!request.rightsConfirmed) return { status: 'unavailable', message: 'Confirm your rights to this content before uploading.' };

  if (!supabase) {
    const projectId = `guest-project-${crypto.randomUUID().slice(0, 8)}`;
    const videoId = `guest-video-${crypto.randomUUID().slice(0, 8)}`;
    const generatedClips = buildLocalGeneratedClips(projectId, videoId, request.url);
    return {
      status: 'accepted',
      message: 'Local demo analysis is complete. Your 10–15 minute source produced 12 short-form reels ready to review.',
      projectId,
      videoId,
      generatedClips,
    };
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { status: 'unavailable', message: 'Sign in with Supabase before uploading or processing video.' };

  const projectName = request.file?.name.replace(/\.[^.]+$/, '') || 'YouTube video';
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ owner_id: user.id, name: projectName, status: 'draft' })
    .select('id')
    .single();
  if (projectError) return { status: 'failed', message: `Could not create project: ${projectError.message}` };

  let storagePath: string | null = null;
  if (request.file) {
    const stored = await storeSourceVideo(user.id, request.file, request.onUploadProgress);
    if ('error' in stored) {
      await supabase.from('projects').update({ status: 'failed' }).eq('id', project.id);
      return { status: 'failed', message: `Upload failed: ${stored.error}`, projectId: project.id };
    }
    storagePath = stored.path;
  }

  const { data: video, error: videoError } = await supabase
    .from('videos')
    .insert({
      owner_id: user.id,
      project_id: project.id,
      source_type: request.file ? 'upload' : 'youtube',
      storage_path: storagePath,
      source_url: request.file ? null : request.url,
      original_name: request.file?.name ?? null,
      rights_confirmed: true,
      processing_status: 'queued',
    })
    .select('id')
    .single();
  if (videoError) {
    if (storagePath) await supabase.storage.from('source-videos').remove([storagePath]);
    await supabase.from('projects').update({ status: 'failed' }).eq('id', project.id);
    return { status: 'failed', message: `Could not save video: ${videoError.message}`, projectId: project.id };
  }

  await supabase.from('projects').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', project.id);
  const { error: functionError } = await supabase.functions.invoke('process-video', { body: { videoId: video.id } });
  if (functionError) {
    await supabase.from('videos').update({ processing_status: 'failed', failure_code: 'processor_unavailable' }).eq('id', video.id);
    await supabase.from('projects').update({ status: 'failed' }).eq('id', project.id);
    return { status: 'failed', message: 'The processing function is unavailable. Your source video remains in your project; check Edge Function deployment and provider configuration.', projectId: project.id, videoId: video.id };
  }
  return { status: 'accepted', message: 'Upload saved. Transcript and clip analysis have started.', projectId: project.id, videoId: video.id };
}

export async function storeSourceVideo(userId: string, file: File, onProgress?: (uploaded: number, total: number) => void): Promise<{ path: string } | { error: string }> {
  if (!supabase) return { error: 'Supabase storage is not configured.' };
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) return { error: error?.message ?? 'Sign in before uploading source media.' };
    const endpoint = `${supabaseUrl!.replace(/\/$/, '')}/storage/v1/upload/resumable`;
    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint,
        retryDelays: [0, 1000, 3000, 5000],
        chunkSize: 6 * 1024 * 1024,
        headers: { apikey: supabaseAnonKey!, Authorization: `Bearer ${session.access_token}` },
        metadata: { bucketName: 'source-videos', objectName: path, contentType: file.type || 'application/octet-stream', cacheControl: '3600' },
        onError: reject,
        onProgress: (uploaded, total) => onProgress?.(uploaded, total),
        onSuccess: () => resolve(),
      });
      upload.start();
    });
    return { path };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Network error during upload.' };
  }
}

export async function requestClipExport(input: ClipExportRequest) {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { data, error } = await supabase.functions.invoke('render-clip', { body: input });
  if (error || !data?.exportId) return { error: 'Video rendering function is unavailable. Check its deployment and provider configuration.' };
  return { exportId: data.exportId as string };
}

export async function createExportDownloadUrl(exportId: string) {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { data: exportRecord, error } = await supabase.from('exports').select('status,storage_path').eq('id', exportId).single();
  if (error) return { error: error.message };
  if (exportRecord.status !== 'ready' || !exportRecord.storage_path) return { error: 'Export is not ready yet.' };
  const { data, error: urlError } = await supabase.storage.from('clip-exports').createSignedUrl(exportRecord.storage_path, 300);
  if (urlError || !data?.signedUrl) return { error: urlError?.message ?? 'Could not create a download link.' };
  return { url: data.signedUrl };
}

export async function submitAuth(mode: 'Sign in' | 'Create account' | 'Reset password', email: string, password: string) {
  if (!supabase) return { error: 'Authentication is not available until Supabase is configured.' };
  if (mode === 'Sign in') {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message };
  }
  if (mode === 'Create account') {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message };
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  return { error: error?.message };
}

export async function signOut() {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.auth.signOut();
  return { error: error?.message };
}
