import { supabase } from './providers';

export type WorkspaceProject = {
  id: string;
  name: string;
  clips: number;
  created: string;
  status: string;
};

export type StoredClip = {
  id: string;
  projectId: string;
  videoId: string;
  startSeconds?: number;
  endSeconds?: number;
  title: string;
  topic: string;
  duration: number;
  score: number;
  category: string;
  description: string;
  hook: string;
  hashtags: string;
  caption: string;
  transcript: string;
  isDemo?: boolean;
};

const guestProjectsKey = 'clipy:guest-projects:v1';
const guestClipsKey = 'clipy:guest-clips:v1';
const demoProject: WorkspaceProject = {
  id: 'demo',
  name: 'The Creative Practice — Demo Project',
  clips: 7,
  created: 'Sep 25, 2026',
  status: 'Demo',
};

function readGuestClips(): StoredClip[] {
  try {
    const saved = localStorage.getItem(guestClipsKey);
    if (!saved) return [];
    const clips = JSON.parse(saved) as StoredClip[];
    return Array.isArray(clips) ? clips : [];
  } catch {
    return [];
  }
}

function writeGuestClips(clips: StoredClip[]) {
  localStorage.setItem(guestClipsKey, JSON.stringify(clips));
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function readGuestProjects(): WorkspaceProject[] {
  try {
    const saved = localStorage.getItem(guestProjectsKey);
    if (!saved) return [demoProject];
    const projects = JSON.parse(saved) as WorkspaceProject[];
    return Array.isArray(projects) ? projects : [demoProject];
  } catch {
    return [demoProject];
  }
}

function writeGuestProjects(projects: WorkspaceProject[]) {
  localStorage.setItem(guestProjectsKey, JSON.stringify(projects));
}

async function currentUserId() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  return data.user?.id ?? null;
}

export async function loadProjects(): Promise<WorkspaceProject[]> {
  if (!supabase) return readGuestProjects();
  const userId = await currentUserId();
  if (!userId) return readGuestProjects();

  const { data, error } = await supabase
    .from('projects')
    .select('id,name,status,created_at,clips(id)')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    clips: project.clips.length,
    created: formatDate(project.created_at),
    status: project.status === 'ready' ? 'Ready' : project.status[0].toUpperCase() + project.status.slice(1),
  }));
}

export async function loadStoredClips(): Promise<StoredClip[]> {
  if (!supabase || !(await currentUserId())) return readGuestClips();
  const { data, error } = await supabase
    .from('clips')
    .select('id,project_id,video_id,start_seconds,end_seconds,ai_content_score,topic,category,clip_metadata(suggested_title,description,hashtags,hook,social_caption,transcript)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return [...(data ?? []).map((clip) => {
    const metadata = Array.isArray(clip.clip_metadata) ? clip.clip_metadata[0] : clip.clip_metadata;
    return {
      id: clip.id,
      projectId: clip.project_id,
      videoId: clip.video_id,
      startSeconds: Number(clip.start_seconds),
      endSeconds: Number(clip.end_seconds),
      title: metadata?.suggested_title || 'Untitled clip',
      topic: clip.topic || 'General',
      duration: Math.round(Number(clip.end_seconds) - Number(clip.start_seconds)),
      score: clip.ai_content_score ?? 0,
      category: clip.category || 'Interesting',
      description: metadata?.description || '',
      hook: metadata?.hook || '',
      hashtags: metadata?.hashtags?.join(' ') || '',
      caption: metadata?.social_caption || '',
      transcript: metadata?.transcript || '',
    };
  }), ...readGuestClips()];
}

export function saveGuestClips(clips: StoredClip[]) {
  writeGuestClips(clips);
}

export async function createProject(name: string): Promise<WorkspaceProject> {
  const userId = await currentUserId();
  if (!supabase || !userId) {
    const project: WorkspaceProject = {
      id: `local-${crypto.randomUUID()}`,
      name,
      clips: 0,
      created: formatDate(new Date().toISOString()),
      status: 'Draft',
    };
    writeGuestProjects([project, ...readGuestProjects()]);
    return project;
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({ owner_id: userId, name, status: 'draft' })
    .select('id,name,status,created_at')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, name: data.name, clips: 0, created: formatDate(data.created_at), status: 'Draft' };
}

export async function renameProject(project: WorkspaceProject, name: string): Promise<void> {
  if (project.id === 'demo' || project.id.startsWith('local-') || !supabase || !(await currentUserId())) {
    writeGuestProjects(readGuestProjects().map((item) => item.id === project.id ? { ...item, name } : item));
    return;
  }
  const { error } = await supabase.from('projects').update({ name, updated_at: new Date().toISOString() }).eq('id', project.id);
  if (error) throw new Error(error.message);
}

export async function deleteProject(project: WorkspaceProject): Promise<void> {
  if (project.id === 'demo' || project.id.startsWith('local-') || !supabase || !(await currentUserId())) {
    writeGuestProjects(readGuestProjects().filter((item) => item.id !== project.id));
    return;
  }
  const { error } = await supabase.from('projects').delete().eq('id', project.id);
  if (error) throw new Error(error.message);
}

export async function duplicateProject(project: WorkspaceProject): Promise<WorkspaceProject> {
  return createProject(`${project.name} (copy)`);
}

export async function getVideoStatus(videoId: string) {
  if (!supabase) {
    const clip = readGuestClips().find((item) => item.videoId === videoId);
    return {
      processing_status: clip ? 'ready' : 'queued',
      failure_code: null,
      project_id: clip?.projectId ?? 'guest-project',
    };
  }
  const { data, error } = await supabase.from('videos').select('processing_status,failure_code,project_id').eq('id', videoId).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getExport(exportId: string) {
  if (!supabase) {
    return {
      status: 'ready',
      storage_path: `demo-export-${exportId}.mp4`,
      failure_code: null,
    };
  }
  const { data, error } = await supabase.from('exports').select('status,storage_path,failure_code').eq('id', exportId).single();
  if (error) throw new Error(error.message);
  return data;
}
