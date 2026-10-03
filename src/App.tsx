import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, AudioLines, Bell, Check, ChevronDown,
  Clock3, Copy, FileVideo2, Film, FolderKanban, Gauge, HelpCircle, Home, Layers3, Link2,
  Menu, Music2, Pencil, Play, Plus, Scissors, Search, Settings, SlidersHorizontal,
  Sparkles, Trash2, Type, Upload, Video, X,
} from 'lucide-react';
import { createExportDownloadUrl, isSupabaseConfigured, requestClipExport, signOut, startVideoAnalysis, submitAuth, supabase, type ClipExportRequest } from './lib/providers';
import { deleteProject as removeProject, duplicateProject as copyProject, getExport, getVideoStatus, loadProjects, loadStoredClips, renameProject as persistRename, type StoredClip, type WorkspaceProject } from './lib/workspace';

type Page = 'dashboard' | 'create' | 'processing' | 'projects' | 'clips' | 'templates' | 'settings';
type Clip = Omit<StoredClip, 'projectId' | 'videoId'> & Partial<Pick<StoredClip, 'projectId' | 'videoId'>> & { isDemo?: boolean };
type Project = WorkspaceProject;

const initialClips: Clip[] = [
  { id: '01', title: 'The question that changes how you set goals', topic: 'Mindset & habits', duration: 48, score: 94, category: 'Educational', description: 'A practical reframing of goal-setting that starts with a better question.', hook: 'What if the way you set goals is the reason they never stick?', hashtags: '#mindset #habits #creators', caption: 'A small shift in the question can change everything. Save this for your next planning session.', transcript: 'Instead of asking what do I want to achieve, ask what kind of person would achieve it? Then build the small, repeatable habits that person would have.' },
  { id: '02', title: 'Why your first idea is rarely your best one', topic: 'Creative process', duration: 52, score: 91, category: 'Interesting', description: 'A clear, memorable way to get past the first obvious idea.', hook: 'Your first idea is usually just the most familiar one.', hashtags: '#creativity #ideas #work', caption: 'Give the obvious answer a moment to breathe, then keep going.', transcript: 'The first idea is the one your brain can reach fastest. It is not always the most interesting one. The useful work often begins after you think you are finished.' },
  { id: '03', title: 'A simple way to make feedback useful', topic: 'Teamwork', duration: 44, score: 88, category: 'Business', description: 'Turn vague feedback into a specific next step with one follow-up question.', hook: 'There is one question that makes vague feedback actionable.', hashtags: '#leadership #feedback #teams', caption: 'Good feedback gets specific. Try this question in your next review.', transcript: 'When someone says it needs more polish, ask what would make it feel finished? That question moves you from taste and opinion to something you can actually improve.' },
  { id: '04', title: 'The best lessons come from the awkward middle', topic: 'Learning', duration: 57, score: 86, category: 'Story', description: 'A short reflection on why progress feels messy before it looks clear.', hook: 'Nobody posts the awkward middle, but that is where the learning happens.', hashtags: '#learning #growth #storytime', caption: 'Progress is allowed to look unfinished while it is happening.', transcript: 'There is a messy middle in almost every skill. You know enough to see what is wrong, but not yet enough to fix it quickly. That feeling is not a signal to stop.' },
  { id: '05', title: 'Make your next decision smaller', topic: 'Productivity', duration: 41, score: 83, category: 'Motivational', description: 'A practical reset for when a project starts to feel too big.', hook: 'If the next step feels impossible, make the step smaller.', hashtags: '#productivity #focus #work', caption: 'Momentum often starts with a next step that is almost too easy.', transcript: 'When a project feels overwhelming, do not try to find motivation for the whole thing. Find the smallest useful action you can finish in ten minutes, and begin there.' },
  { id: '06', title: 'The meeting that could have been an email', topic: 'Office stories', duration: 46, score: 81, category: 'Funny', description: 'A light story about the small rituals that make work feel longer.', hook: 'We scheduled a meeting to decide if we needed the meeting.', hashtags: '#worklife #officehumor #meetings', caption: 'An agenda item about whether we need an agenda item.', transcript: 'We got everyone into a room to decide whether the project needed another meeting. After forty minutes, we decided to schedule a follow-up to write down the decision.' },
  { id: '07', title: 'The note I kept from my first mentor', topic: 'Perspective', duration: 55, score: 89, category: 'Emotional', description: 'A quiet reminder about giving yourself room to learn.', hook: 'I found a note from someone who believed in me before I did.', hashtags: '#growth #mentorship #perspective', caption: 'Keep the words that helped you become a little kinder to yourself.', transcript: 'My first mentor wrote, you do not have to be ready to begin. I found that note years later, and realized how often I had waited for confidence instead of letting the work teach me.' },
];

const navItems: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'create', label: 'Create Shorts', icon: Plus },
  { id: 'projects', label: 'My Projects', icon: FolderKanban },
  { id: 'clips', label: 'My Clips', icon: Film },
  { id: 'templates', label: 'Templates', icon: Layers3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const pageNames: Record<Page, string> = { dashboard: 'Dashboard', create: 'Create Shorts', processing: 'Processing', projects: 'My Projects', clips: 'My Clips', templates: 'Templates', settings: 'Settings' };
const categories = ['All', 'Educational', 'Funny', 'Emotional', 'Story', 'Business', 'Motivational', 'Interesting'];
const configuredMaxUploadMb = Number(import.meta.env.VITE_MAX_UPLOAD_MB);
const maxUploadMb = Number.isFinite(configuredMaxUploadMb) && configuredMaxUploadMb > 0 ? configuredMaxUploadMb : 500;

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const demoClips = initialClips.map((clip) => ({ ...clip, isDemo: true }));
  const [clips, setClips] = useState<Clip[]>(demoClips);
  const [projects, setProjects] = useState<Project[]>([{ id: 'demo', name: 'The Creative Practice — Demo Project', clips: 7, created: 'Sep 25, 2026', status: 'Demo' }]);
  const [selectedClip, setSelectedClip] = useState<Clip>(demoClips[0]);
  const [toast, setToast] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [filter, setFilter] = useState('All');
  const [sort, setSort] = useState('AI Score');
  const [search, setSearch] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [processingVideo, setProcessingVideo] = useState<{ videoId: string; projectId: string } | null>(null);
  const [hasRights, setHasRights] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setUserEmail(data.session?.user.email ?? '');
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? '');
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadProjects(), loadStoredClips()]).then(([savedProjects, savedClips]) => {
      if (!mounted) return;
      setProjects(savedProjects);
      setClips([...savedClips as Clip[], ...demoClips]);
    }).catch((error: unknown) => {
      if (mounted) notify(error instanceof Error ? error.message : 'Could not load your saved workspace.');
    });
    return () => { mounted = false; };
  }, [userEmail]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 3600);
  }

  function go(next: Page) {
    setPage(next);
    setMobileMenu(false);
  }

  function addFile(selected: File | undefined) {
    if (!selected) return;
    if (selected.size > maxUploadMb * 1024 * 1024) {
      setFile(null);
      notify(`This file exceeds the ${maxUploadMb} MB upload limit.`);
      return;
    }
    if (!['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/avi'].includes(selected.type) && !/\.(mp4|mov|webm|avi)$/i.test(selected.name)) {
      setFile(null);
      notify('Unsupported format. Choose an MP4, MOV, WEBM, or AVI video.');
      return;
    }
    setFile(selected);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    addFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    addFile(event.dataTransfer.files[0]);
  }

  async function analyze() {
    if (!file && !url) {
      notify('Choose a video file or paste a YouTube URL first.');
      return;
    }
    if (url && !isValidYouTubeUrl(url)) {
      setUrlError('Please enter a valid YouTube URL.');
      return;
    }
    if (!hasRights) {
      notify('Confirm that you have permission to process this video.');
      return;
    }
    setUrlError('');
    setIsAnalyzing(true);
    try {
      const result = await startVideoAnalysis({ file, url: file ? undefined : url || undefined, rightsConfirmed: hasRights });
      notify(result.message);
      if (result.status === 'accepted' && result.videoId && result.projectId) {
        setProcessingVideo({ videoId: result.videoId, projectId: result.projectId });
        if (result.generatedClips?.length) {
          const guestClips = result.generatedClips;
          const unique = guestClips.filter((clip) => !clips.some((item) => item.id === clip.id && item.projectId === clip.projectId));
          setClips((current) => [...unique, ...current]);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('clipy:guest-clips:v1', JSON.stringify([...guestClips, ...JSON.parse(localStorage.getItem('clipy:guest-clips:v1') ?? '[]')]));
          }
          const projectTitle = url ? `YouTube analysis · ${new URL(url).hostname.replace('www.', '')}` : `Generated project · ${file?.name ?? 'video'}`;
          setProjects((current) => [{ id: result.projectId!, name: projectTitle, clips: guestClips.length, created: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }), status: 'Ready' }, ...current]);
          setSelectedClip(guestClips[0]);
        } else {
          setProjects(await loadProjects());
        }
        setPage('processing');
      } else if (result.projectId) {
        setProjects(await loadProjects());
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Upload failed. Check your connection and try again.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function exportClip(clip: Clip, settings: Partial<ClipExportRequest> = {}) {
    if (clip.isDemo) {
      notify('Demo clips have no source media to export.');
      return;
    }
    notify('Export queued. Waiting for the rendering provider.');
    try {
      const queued = await requestClipExport({ clipId: clip.id, resolution: '1080p', aspectRatio: '9:16', captions: true, ...settings });
      if (queued.error || !queued.exportId) {
        notify(queued.error ?? 'Could not queue export.');
        return;
      }
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const exportRecord = await getExport(queued.exportId);
        if (exportRecord.status === 'failed') {
          notify(`Export failed: ${exportRecord.failure_code ?? 'rendering error'}`);
          return;
        }
        if (exportRecord.status === 'ready') {
          const download = await createExportDownloadUrl(queued.exportId);
          if (download.error || !download.url) {
            notify(download.error ?? 'Could not create download link.');
            return;
          }
          const anchor = document.createElement('a');
          anchor.href = download.url;
          anchor.download = `${clip.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.mp4`;
          anchor.click();
          notify('Your MP4 export is ready.');
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
      notify('Export is still processing. Check My Clips again shortly.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Export failed.');
    }
  }

  const visibleClips = useMemo(() => {
    const matching = clips.filter((clip) => (filter === 'All' || clip.category === filter) && `${clip.title} ${clip.topic}`.toLowerCase().includes(search.toLowerCase()));
    return matching.sort((a, b) => sort === 'Duration' ? a.duration - b.duration : sort === 'Oldest' ? b.id.localeCompare(a.id) : sort === 'Newest' ? a.id.localeCompare(b.id) : b.score - a.score);
  }, [clips, filter, search, sort]);

  async function duplicateProject(project: Project) {
    try {
      const duplicate = await copyProject(project);
      setProjects((current) => [duplicate, ...current]);
      notify('Project duplicated.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Project duplication failed.');
    }
  }

  function renameProject(project: Project) {
    const name = window.prompt('Project name', project.name);
    if (name?.trim()) void persistRename(project, name.trim()).then(() => {
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, name: name.trim() } : item));
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Project rename failed.'));
  }

  function deleteProject(project: Project) {
    if (!window.confirm(`Delete "${project.name}" from this demo workspace?`)) return;
    void removeProject(project).then(() => {
      setProjects((current) => current.filter((item) => item.id !== project.id));
      notify('Project deleted.');
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Project deletion failed.'));
  }

  function editClip(clip: Clip) {
    setSelectedClip(clip);
    go('clips');
  }

  async function handleProfileClick() {
    if (!userEmail) {
      setAuthOpen(true);
      return;
    }
    const result = await signOut();
    notify(result.error ?? 'Signed out.');
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#dashboard" onClick={(event) => { event.preventDefault(); go('dashboard'); }}>
          <span className="brand-mark"><AudioLines size={19} strokeWidth={2.4} /></span>
          <span>Clipy</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button className={`nav-item ${page === id ? 'active' : ''}`} key={id} onClick={() => go(id)}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{id === 'create' && <span className="nav-add"><Plus size={13} /></span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-box">
            <div className="plan-top"><span className="plan-dot" /> Free workspace</div>
            <div className="plan-copy">Credits are not connected yet.</div>
            <button className="plan-button" onClick={() => notify('Billing is not configured yet.')}>Explore plans <ArrowUpRight size={14} /></button>
          </div>
          <button className="help-link" onClick={() => notify('Provider setup details are in the project README.')}><HelpCircle size={16} /> Help & support</button>
          <button className="profile-row" onClick={handleProfileClick}>
            <span className="avatar">{userEmail ? userEmail.slice(0, 2).toUpperCase() : 'CF'}</span><span className="profile-text"><strong>{userEmail || 'Guest workspace'}</strong><small>{userEmail ? 'Click to sign out' : 'Sign in to sync projects'}</small></span><ChevronDown size={15} />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu-button" aria-label="Open menu" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={19} /></button><span className="crumb">Workspace</span><span className="crumb-slash">/</span><strong>{pageNames[page]}</strong></div>
          <div className="topbar-actions"><span className="credits"><Sparkles size={14} /> <b>--</b> credits</span><button className="icon-button notification-button" aria-label="Notifications" onClick={() => notify('You are all caught up.')}><Bell size={17} /></button><button className="top-avatar" aria-label={userEmail ? 'Sign out' : 'Sign in'} onClick={handleProfileClick}>{userEmail ? userEmail.slice(0, 2).toUpperCase() : 'CF'}</button></div>
        </header>
        <div className="page-content">
          {page === 'dashboard' && <Dashboard clips={clips} projects={projects} onCreate={() => go('create')} onEdit={editClip} onBrowse={() => go('clips')} onNotify={notify} onExport={exportClip} />}
          {page === 'create' && <CreatePage file={file} url={url} urlError={urlError} hasRights={hasRights} isAnalyzing={isAnalyzing} onRightsChange={setHasRights} onFileChange={onFileChange} onDrop={onDrop} setUrl={setUrl} analyze={analyze} />}
          {page === 'processing' && processingVideo && <ProcessingPage videoId={processingVideo.videoId} projectId={processingVideo.projectId} onOpenProjects={() => go('projects')} onOpenClips={async () => { setClips([...await loadStoredClips(), ...demoClips]); go('clips'); }} />}
          {page === 'projects' && <ProjectsPage projects={projects} onOpen={() => go('clips')} onRename={renameProject} onDuplicate={duplicateProject} onDelete={deleteProject} onCreate={() => go('create')} />}
          {page === 'clips' && <ClipsPage clips={visibleClips} filter={filter} sort={sort} search={search} selectedClip={selectedClip} setFilter={setFilter} setSort={setSort} setSearch={setSearch} onEdit={editClip} onNotify={notify} onExport={exportClip} />}
          {page === 'templates' && <TemplatesPage onNotify={notify} />}
          {page === 'settings' && <SettingsPage onNotify={notify} configured={isSupabaseConfigured} />}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">{navItems.slice(0, 5).map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => go(id)}><Icon size={18} /><span>{label === 'Dashboard' ? 'Home' : label === 'Create Shorts' ? 'Create' : label === 'My Projects' ? 'Projects' : label === 'My Clips' ? 'Clips' : 'Templates'}</span></button>)}</nav>
      {toast && <div className="toast" role="status"><span className="toast-mark"><Check size={14} /></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></button></div>}
      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onNotify={notify} configured={isSupabaseConfigured} />}
    </div>
  );
}

function isValidYouTubeUrl(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be' || host === 'www.youtu.be') return parsed.pathname.split('/').filter(Boolean).length === 1;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) return false;
    return Boolean(parsed.searchParams.get('v') || parsed.pathname.match(/^\/(shorts|live|embed)\/[^/]+/));
  } catch {
    return false;
  }
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>;
}

function Dashboard({ clips, projects, onCreate, onEdit, onBrowse, onNotify, onExport }: { clips: Clip[]; projects: Project[]; onCreate: () => void; onEdit: (clip: Clip) => void; onBrowse: () => void; onNotify: (message: string) => void; onExport: (clip: Clip) => void }) {
  return <>
    <PageHeading eyebrow="FRIDAY, SEPTEMBER 25, 2026" title="Good work starts with a good moment." description="Turn a 10–15 minute video into 10–15 punchy short reels. Find the strongest hooks, shape them into mobile-first stories, and export them fast." action={<button className="button button-primary" onClick={onCreate}><Plus size={16} /> Create Shorts</button>} />
    <div className="demo-banner"><span className="demo-pip" /><strong>Demo workspace</strong><span>These sample clips are illustrative and were not generated from your video.</span></div>
    <section className="welcome-panel">
      <div className="welcome-copy"><div className="mini-label"><Sparkles size={13} /> YOUR VIDEO WORKSPACE</div><h2>One 10–15 min video.<br /><span>10–15 reels ready.</span></h2><p>Drop a long-form recording or YouTube video and let Clipy turn it into a batch of short, hook-led reels made for social discovery.</p><div className="welcome-actions"><button className="button button-light" onClick={onCreate}>Create Shorts <ArrowRight size={15} /></button><button className="welcome-secondary" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>See how it works</button></div></div>
      <div className="welcome-art" aria-label="Illustration of one long video becoming short clips"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-source"><AudioLines size={24}/><span>LONG FORM</span><i>48:32</i></div><div className="art-beam"/><div className="art-clips"><div><Play size={12} fill="currentColor"/><span>00:48</span></div><div><Play size={12} fill="currentColor"/><span>00:52</span></div><div><Play size={12} fill="currentColor"/><span>00:44</span></div></div><span className="art-label">ONE STORY <span>→</span> MANY MOMENTS</span></div>
    </section>
    <section className="stat-row"><Stat icon={<FolderKanban size={17}/>} label="Projects" value={String(projects.length).padStart(2, '0')} caption="In this workspace"/><Stat icon={<Film size={17}/>} label="Shorts found" value={String(clips.length).padStart(2, '0')} caption="Demo examples"/><Stat icon={<Clock3 size={17}/>} label="Processing" value="Not set up" caption="Connect a provider"/></section>
    <section className="section-block"><div className="section-title-row"><div><div className="eyebrow">YOUR RECENT MOMENTS</div><h2>Clips and examples <span className="inline-demo">DEMO LABELED</span></h2></div><button className="text-button" onClick={onBrowse}>Browse all <ArrowRight size={15}/></button></div><div className="clip-grid">{clips.slice(0, 3).map((clip, index) => <ClipCard key={clip.id} clip={clip} index={index} onEdit={() => onEdit(clip)} onNotify={onNotify} onExport={onExport}/>)}</div></section>
    <div className="integration-note" id="how-it-works"><span className="note-icon"><Gauge size={16}/></span><div><strong>Content-led, not time-led.</strong><span>Clip selection is designed around complete thoughts, strong hooks, and natural endings. Real analysis starts when a provider is connected.</span></div><ArrowUpRight size={16}/></div>
  </>;
}

function Stat({ icon, label, value, caption }: { icon: ReactNode; label: string; value: string; caption: string }) {
  return <div className="stat-card"><span className="stat-icon">{icon}</span><div><span className="stat-label">{label}</span><strong>{value}</strong><small>{caption}</small></div></div>;
}

function CreatePage({ file, url, urlError, hasRights, isAnalyzing, onRightsChange, onFileChange, onDrop, setUrl, analyze }: { file: File | null; url: string; urlError: string; hasRights: boolean; isAnalyzing: boolean; onRightsChange: (value: boolean) => void; onFileChange: (event: ChangeEvent<HTMLInputElement>) => void; onDrop: (event: DragEvent<HTMLLabelElement>) => void; setUrl: (value: string) => void; analyze: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <>
    <PageHeading eyebrow="NEW PROJECT" title="Create your next short." description={isSupabaseConfigured ? 'Upload a source video. Sign in to save it privately, then the configured providers will transcribe and find natural moments.' : 'Connect Supabase and processing providers to save uploads and analyze your video.'} />
    <div className="create-layout"><section className="create-main"><div className="panel panel-upload"><div className="panel-heading"><div><h2>Bring your video</h2><p>Upload a file or share a public YouTube link.</p></div><span className="step-pill">STEP 01 <span>OF 02</span></span></div>
      <input ref={inputRef} className="visually-hidden" type="file" accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,.mp4,.mov,.webm,.avi" onChange={onFileChange}/>
      <label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onClick={() => inputRef.current?.click()}>
        <span className="upload-icon">{file ? <FileVideo2 size={22}/> : <Upload size={21}/>}</span><strong>{file ? file.name : 'Drop your video here'}</strong><span>{file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB · Ready to submit` : 'or click to browse your files'}</span><span className="format-list"><b>MP4</b><b>MOV</b><b>WEBM</b><b>AVI</b></span><span>Maximum file size: {maxUploadMb} MB</span>
      </label>
      <div className="or-divider"><span>OR USE A LINK</span></div>
      <label className="field-label" htmlFor="video-url">YouTube video URL</label><div className={`url-input ${urlError ? 'input-error' : ''}`}><Link2 size={17}/><input id="video-url" type="url" placeholder="https://youtube.com/watch?v=..." value={url} onChange={(event) => setUrl(event.target.value)}/></div>{urlError && <div className="field-error">{urlError}</div>}
      <label className="rights-check"><input type="checkbox" checked={hasRights} onChange={(event) => onRightsChange(event.target.checked)}/><span>I own this video or have permission to upload and process it.</span></label>
      <button className="button button-primary analyze-button" onClick={analyze} disabled={isAnalyzing}><Sparkles size={16}/> {isAnalyzing ? 'Uploading and starting analysis…' : 'Analyze video'} <ArrowRight size={15}/></button><div className="privacy-note"><span className="privacy-dot"/> Your source stays in private storage. YouTube restrictions and access controls are never bypassed.</div>
    </div></section>
    <aside className="create-aside"><div className="aside-card aside-dark"><span className="aside-icon"><Sparkles size={17}/></span><h3>Meaning over minutes.</h3><p>Well-chosen shorts have a clear beginning, a complete idea, and a satisfying end. The target is 40–60 seconds, not arbitrary cuts.</p><div className="selection-tags"><span>Strong opening</span><span>Complete thought</span><span>Natural ending</span></div></div><div className="aside-card"><div className="eyebrow">BEFORE YOU START</div><div className="requirement"><Check size={15}/> Permission confirmation required</div><div className="requirement"><Check size={15}/> Uploads require an account</div><div className="requirement"><Check size={15}/> Analysis runs server-side</div><div className="provider-warning"><span className="status-dot"/>{isSupabaseConfigured ? 'Processing depends on deployed providers' : 'Supabase and providers not configured'}</div></div></aside></div>
  </>;
}

function ProcessingPage({ videoId, projectId, onOpenProjects, onOpenClips }: { videoId: string; projectId: string; onOpenProjects: () => void; onOpenClips: () => void }) {
  const [status, setStatus] = useState<'queued' | 'processing' | 'ready' | 'failed'>('queued');
  const [failureCode, setFailureCode] = useState('');
  const [statusError, setStatusError] = useState('');

  useEffect(() => {
    let mounted = true;
    let interval = 0;
    const poll = async () => {
      try {
        const result = await getVideoStatus(videoId);
        if (!mounted) return;
        setStatus(result.processing_status as 'queued' | 'processing' | 'ready' | 'failed');
        setFailureCode(result.failure_code ?? '');
        setStatusError('');
        if (result.processing_status === 'ready' || result.processing_status === 'failed') window.clearInterval(interval);
      } catch (error) {
        if (mounted) setStatusError(error instanceof Error ? error.message : 'Status check failed.');
      }
    };
    void poll();
    interval = window.setInterval(() => { void poll(); }, 3000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [videoId]);

  const labels = { queued: 'Queued', processing: 'Transcribing and selecting moments', ready: 'Clips are ready', failed: 'Processing failed' };
  return <><PageHeading eyebrow={`PROJECT ${projectId.slice(0, 8)}`} title={labels[status]} description={status === 'ready' ? 'Analysis results were saved to your project.' : status === 'failed' ? 'Your upload is preserved. Review the service configuration and retry from the project.' : 'The status below comes from the saved video record. No percentage is estimated.'}/><section className="processing-panel"><div className={`processing-emblem ${status}`}><span>{status === 'ready' ? <Check size={24}/> : status === 'failed' ? <X size={24}/> : <AudioLines size={24}/>}</span></div><div className="processing-status"><span className={`project-status ${status === 'ready' ? 'is-demo' : ''}`}><i/>{status}</span><h2>{labels[status]}</h2><p>{status === 'queued' ? 'Waiting for the server-side worker to begin.' : status === 'processing' ? 'The transcription and moment-analysis providers are working on your source.' : status === 'ready' ? 'Your selected moments and metadata are persisted.' : `The worker reported: ${failureCode || statusError || 'provider_failed'}`}</p>{statusError && <span className="field-error">Status check: {statusError}</span>}{status === 'failed' && <button className="button button-outline" onClick={onOpenProjects}><FolderKanban size={14}/> Open project</button>}{status === 'ready' && <button className="button button-primary" onClick={onOpenClips}><Film size={14}/> Review generated clips</button>}</div><div className="processing-foot"><span>Video ID</span><code>{videoId}</code><span>Updates every 3 seconds from Supabase</span></div></section></>;
}

function ProjectsPage({ projects, onOpen, onRename, onDuplicate, onDelete, onCreate }: { projects: Project[]; onOpen: () => void; onRename: (project: Project) => void; onDuplicate: (project: Project) => void; onDelete: (project: Project) => void; onCreate: () => void }) {
  return <><PageHeading eyebrow="YOUR LIBRARY" title="My Projects" description="A home for every long-form video and the moments you find in it." action={<button className="button button-primary" onClick={onCreate}><Plus size={16}/> New project</button>}/>
    {projects.length === 0 ? <EmptyState onCreate={onCreate}/> : <div className="projects-table"><div className="project-table-head"><span>PROJECT</span><span>CLIPS</span><span>CREATED</span><span>STATUS</span><span/></div>{projects.map((project) => <div className="project-row" key={project.id}><button className="project-name" onClick={onOpen}><span className="project-thumb"><Video size={18}/></span><span><strong>{project.name}</strong><small>Original video · source not attached</small></span></button><span className="project-count"><Film size={14}/>{project.clips}</span><span className="project-date">{project.created}</span><span className={`project-status ${project.status === 'Demo' ? 'is-demo' : ''}`}><i/>{project.status}</span><div className="project-actions"><button className="icon-button" aria-label="Rename project" title="Rename" onClick={() => onRename(project)}><Pencil size={15}/></button><button className="icon-button" aria-label="Duplicate project" title="Duplicate" onClick={() => onDuplicate(project)}><Copy size={15}/></button><button className="icon-button danger-hover" aria-label="Delete project" title="Delete" onClick={() => onDelete(project)}><Trash2 size={15}/></button></div></div>)}</div>}
  </>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><FolderKanban size={25}/></span><h2>No projects yet</h2><p>Upload your first video and give your best moments somewhere to land.</p><button className="button button-primary" onClick={onCreate}><Plus size={16}/> Create your first short</button></div>;
}

function ClipsPage({ clips, filter, sort, search, selectedClip, setFilter, setSort, setSearch, onEdit, onNotify, onExport }: { clips: Clip[]; filter: string; sort: string; search: string; selectedClip: Clip; setFilter: (value: string) => void; setSort: (value: string) => void; setSearch: (value: string) => void; onEdit: (clip: Clip) => void; onNotify: (message: string) => void; onExport: (clip: Clip) => void }) {
  return <><PageHeading eyebrow="YOUR CLIPS · DEMOS ARE LABELED" title="Moments worth keeping." description="Review saved AI-selected moments alongside clearly labeled sample clips." action={<button className="button button-outline" onClick={() => onNotify('Regenerate requires selecting a project and a configured analysis provider.')}><Sparkles size={15}/> Find another moment</button>}/>
    <div className="clips-toolbar"><div className="filter-list" role="group" aria-label="Filter clips">{categories.map((category) => <button key={category} className={`filter-chip ${filter === category ? 'selected' : ''}`} onClick={() => setFilter(category)}>{category}</button>)}</div><div className="clip-tools"><label className="search-field"><Search size={15}/><input aria-label="Search clips" placeholder="Search clips" value={search} onChange={(event) => setSearch(event.target.value)}/></label><label className="sort-select"><SlidersHorizontal size={15}/><select aria-label="Sort clips" value={sort} onChange={(event) => setSort(event.target.value)}><option>AI Score</option><option>Duration</option><option>Newest</option><option>Oldest</option></select><ChevronDown size={14}/></label></div></div>
    {clips.length ? <div className="clip-grid clip-grid-all">{clips.map((clip, index) => <ClipCard key={clip.id} clip={clip} index={index} onEdit={() => onEdit(clip)} onNotify={onNotify} onExport={onExport}/>)}</div> : <div className="empty-filter"><Search size={21}/><strong>No matching moments</strong><span>Try a different filter or search.</span></div>}
    <div className="generate-more"><span className="generate-symbol"><Plus size={17}/></span><div><strong>Looking for something else?</strong><span>Ask the analysis service for more moments from your original video.</span></div><button className="button button-outline" onClick={() => onNotify('AI processing provider not configured.')}>Generate more clips</button></div>
    <Editor clip={selectedClip} onNotify={onNotify} onExport={onExport}/>
  </>;
}

function ClipCard({ clip, index, onEdit, onNotify, onExport }: { clip: Clip; index: number; onEdit: () => void; onNotify: (message: string) => void; onExport: (clip: Clip) => void }) {
  const previewMessage = clip.isDemo ? 'Preview unavailable: this demo has no source video attached.' : 'Render an MP4 export to preview this saved clip.';
  return <article className="clip-card"><div className={`clip-thumbnail thumb-${index % 5}`}><span className="thumb-noise"/><span className="thumb-demo">{clip.isDemo ? 'SAMPLE' : 'AI SELECTED'}</span><span className="thumb-orb"/><button className="play-preview" aria-label={`Preview ${clip.title}`} onClick={() => onNotify(previewMessage)}><Play size={16} fill="currentColor"/></button><span className="thumb-duration">00:{String(clip.duration).padStart(2, '0')}</span><span className="thumb-index">{clip.id.slice(0, 8)}</span></div><div className="clip-card-body"><div className="clip-topic-row"><span className="clip-topic">{clip.topic}</span><span className="demo-tag">{clip.isDemo ? 'DEMO' : 'SAVED'}</span></div><h3>{clip.title}</h3><p className="clip-description">{clip.description}</p><div className="clip-score-row"><span className="score-gauge" title="AI Content Score"><Gauge size={14}/> {clip.score}<small>/100</small></span><span className="clip-category">{clip.category}</span></div><div className="clip-card-actions"><button className="button button-outline button-small" onClick={() => onNotify(previewMessage)}><Play size={13}/> Preview</button><button className="button button-primary button-small" onClick={onEdit}><Pencil size={13}/> Edit</button><button className="icon-button" title={clip.isDemo ? 'Demo media cannot be exported' : 'Render and download MP4'} aria-label="Download clip" disabled={clip.isDemo} onClick={() => onExport(clip)}><ArrowDownToLine size={16}/></button></div></div></article>;
}

function Editor({ clip, onNotify, onExport }: { clip: Clip; onNotify: (message: string) => void; onExport: (clip: Clip, settings?: Partial<ClipExportRequest>) => void }) {
  const [ratio, setRatio] = useState('9:16');
  const [captionOn, setCaptionOn] = useState(true);
  const [captionStyle, setCaptionStyle] = useState('Highlight');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(100);
  const [activeTab, setActiveTab] = useState('Captions');
  return <section className="editor-section"><div className="section-title-row"><div><div className="eyebrow">SAMPLE CLIP · NO SOURCE VIDEO</div><h2>Edit your moment</h2></div><span className="editor-unsaved">Local preview controls</span></div><div className="editor-layout"><div className="editor-preview-column"><div className={`video-stage ratio-${ratio.replace(':', '-')}`}><div className="stage-grid"/><div className="stage-label"><span className="demo-pip"/> SAMPLE PREVIEW</div><div className="stage-content"><span className="stage-wave"><AudioLines size={26}/></span><span className="stage-title">{clip.title}</span><span className="stage-subtitle">No source video connected</span></div><button className="stage-play" aria-label="Play sample preview" onClick={() => onNotify('Preview unavailable: this sample clip has no source video attached.')}><Play size={17} fill="currentColor"/></button><span className="stage-caption">{captionOn ? clip.hook : 'Captions off'}</span></div><div className="preview-controls"><button className="icon-button" aria-label="Preview" onClick={() => onNotify('Preview unavailable: this sample clip has no source video attached.')}><Play size={16}/></button><span>00:08 <i>/</i> 00:{String(clip.duration).padStart(2, '0')}</span><span className="preview-spacer"/><button className="icon-button" title="Preview unavailable" aria-label="Fullscreen" onClick={() => onNotify('A rendered video preview is not available for sample clips.')}><ArrowUpRight size={16}/></button></div><div className="timeline-head"><span><AudioLines size={14}/> Timeline</span><span>00:00 <i>–</i> 00:{String(clip.duration).padStart(2, '0')}</span></div><div className="timeline-ruler"><span>00:00</span><span>00:15</span><span>00:30</span><span>00:{String(clip.duration).padStart(2, '0')}</span></div><div className="timeline-track"><span className="track-label"><Video size={13}/> Video</span><div className="track-content"><div className="timeline-clip"><span/><span/><span/><span/></div></div></div><div className="timeline-track"><span className="track-label"><Music2 size={13}/> Audio</span><div className="track-content"><div className="audio-wave">{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ height: `${15 + ((i * 17 + 23) % 75)}%` }}/>)}</div></div></div><div className="timeline-track"><span className="track-label"><Type size={13}/> Captions</span><div className="track-content"><div className={`caption-block ${captionOn ? '' : 'muted-block'}`}>{captionOn ? 'Sample caption timing' : 'Captions off'}</div></div></div></div>
      <aside className="editor-controls"><div className="editor-tabs">{['Captions', 'Crop', 'Audio', 'Text'].map((tab) => <button key={tab} className={activeTab === tab ? 'selected' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>
        {activeTab === 'Captions' && <div className="control-body"><div className="control-title"><div><h3>Auto captions</h3><p>Settings are local to this sample.</p></div><button className={`toggle ${captionOn ? 'on' : ''}`} role="switch" aria-checked={captionOn} aria-label="Auto captions" onClick={() => setCaptionOn(!captionOn)}><span/></button></div><label className="field-label" htmlFor="caption-style">Style</label><select className="form-select" id="caption-style" value={captionStyle} onChange={(event) => setCaptionStyle(event.target.value)}>{['Clean', 'Bold', 'Minimal', 'Highlight', 'Creator', 'Modern'].map((style) => <option key={style}>{style}</option>)}</select><label className="field-label" htmlFor="caption-size">Text size <span className="label-value">32 px</span></label><input id="caption-size" className="range-input" type="range" min="16" max="56" defaultValue="32"/><label className="field-label" htmlFor="highlight-words">Highlight key words</label><button className="toggle-row" id="highlight-words" onClick={() => onNotify('Smart caption analysis requires a connected AI provider.')}><span>Use AI to find emphasis</span><span className="toggle"><span/></span></button><div className="provider-warning compact-warning"><span className="status-dot"/> Smart timing requires a transcript provider.</div><button className="text-button remove-captions" onClick={() => setCaptionOn(false)}>Remove captions <X size={14}/></button></div>}
        {activeTab === 'Crop' && <div className="control-body"><h3>Frame your shot</h3><p className="control-hint">Preview changes apply to the sample canvas only.</p><label className="field-label">Aspect ratio</label><div className="ratio-picker">{['9:16', '16:9', '1:1'].map((item) => <button key={item} className={ratio === item ? 'chosen' : ''} onClick={() => setRatio(item)}><span className={`ratio-shape ratio-shape-${item.replace(':', '-')}`}/>{item}</button>)}</div><label className="field-label">Position</label><div className="position-picker">{['Original', 'Center', 'Left', 'Right', 'Custom'].map((item) => <button key={item} onClick={() => onNotify(`${item} framing is a preview control; source video is not attached.`)}>{item}</button>)}</div><button className="button button-outline full-button" onClick={() => onNotify('Custom crop is available when source video rendering is connected.')}><SlidersHorizontal size={14}/> Adjust crop</button></div>}
        {activeTab === 'Audio' && <div className="control-body"><h3>Sound mix</h3><p className="control-hint">No audio source is attached to this sample.</p><label className="field-label">Original volume <span className="label-value">100%</span></label><input className="range-input" type="range" min="0" max="100" defaultValue="100"/><label className="field-label">Background music <span className="label-value">0%</span></label><input className="range-input" type="range" min="0" max="100" defaultValue="0"/><button className="button button-outline full-button" onClick={() => onNotify('Audio controls will apply to source media after a rendering provider is connected.')}><Music2 size={14}/> Add audio</button></div>}
        {activeTab === 'Text' && <div className="control-body"><h3>Text overlay</h3><p className="control-hint">Add a title or call to action to your frame.</p><label className="field-label" htmlFor="overlay-text">Overlay text</label><textarea className="overlay-input" id="overlay-text" placeholder="Type something to add..." rows={3}/><label className="field-label" htmlFor="overlay-position">Position</label><select className="form-select" id="overlay-position"><option>Lower third</option><option>Top</option><option>Center</option></select><button className="button button-outline full-button" onClick={() => onNotify('Overlay preview is local. Rendering requires a connected video provider.')}><Plus size={14}/> Add text</button></div>}
        <div className="trim-controls"><div className="trim-heading"><ScissorsIcon/><span>Trim clip</span><span className="trim-value">{Math.max(1, Math.round((end - start) * clip.duration / 100))} sec</span></div><label htmlFor="trim-start">Start <span>{Math.round(start * clip.duration / 100)}s</span></label><input id="trim-start" className="range-input" type="range" min="0" max={end - 5} value={start} onChange={(event) => setStart(Number(event.target.value))}/><label htmlFor="trim-end">End <span>{Math.round(end * clip.duration / 100)}s</span></label><input id="trim-end" className="range-input" type="range" min={start + 5} max="100" value={end} onChange={(event) => setEnd(Number(event.target.value))}/></div>
        <div className="editor-footer"><button className="button button-outline" onClick={() => onNotify('Find another moment requires selecting a source project and rerunning the analysis provider.')}><Sparkles size={14}/> Find another moment</button><button className="button button-primary" disabled={clip.isDemo} onClick={() => onExport(clip, { aspectRatio: ratio as ClipExportRequest['aspectRatio'], captions: captionOn, startSeconds: (clip.startSeconds ?? 0) + clip.duration * start / 100, endSeconds: (clip.startSeconds ?? 0) + clip.duration * end / 100 })}><ArrowDownToLine size={14}/> Export</button></div>
      </aside></div>
      <MetadataEditor clip={clip}/>
  </section>;
}

function ScissorsIcon() { return <Scissors size={14}/>; }

function MetadataEditor({ clip }: { clip: Clip }) {
  return <section className="metadata-panel"><div className="section-title-row"><div><div className="eyebrow">SAMPLE METADATA</div><h2>Make it yours</h2></div><span className="local-label">Edits are not saved</span></div><div className="metadata-grid"><div><label className="field-label" htmlFor="meta-title">Suggested title</label><input className="text-input" id="meta-title" defaultValue={clip.title}/></div><div><label className="field-label" htmlFor="meta-hook">Hook</label><input className="text-input" id="meta-hook" defaultValue={clip.hook}/></div><div><label className="field-label" htmlFor="meta-caption">Social caption</label><textarea className="text-input" id="meta-caption" rows={3} defaultValue={clip.caption}/></div><div><label className="field-label" htmlFor="meta-description">Description</label><textarea className="text-input" id="meta-description" rows={3} defaultValue={clip.description}/></div><div className="metadata-full"><label className="field-label" htmlFor="meta-hashtags">Hashtags</label><input className="text-input" id="meta-hashtags" defaultValue={clip.hashtags}/></div></div></section>;
}

function TemplatesPage({ onNotify }: { onNotify: (message: string) => void }) {
  const templates = [{ name: 'The clean cut', desc: 'Quiet framing, crisp subtitles.', style: 'template-clean' }, { name: 'Word by word', desc: 'Bold type with a moving highlight.', style: 'template-bold' }, { name: 'The field note', desc: 'A considered editorial look.', style: 'template-note' }];
  return <><PageHeading eyebrow="YOUR STYLE" title="Templates" description="A starting point for how your shorts look. Apply a style when you edit a clip."/><div className="template-grid">{templates.map((template) => <article className="template-card" key={template.name}><div className={`template-preview ${template.style}`}><span className="template-frame"><span className="template-subtitle">A thought<br/>worth sharing.</span></span><span className="template-format">9:16</span></div><div className="template-info"><div><h3>{template.name}</h3><p>{template.desc}</p></div><button className="icon-button" title="Template setup not connected" aria-label={`Use ${template.name}`} onClick={() => onNotify('Template selection is a UI preview; video rendering is not configured.')}><ArrowUpRight size={17}/></button></div></article>)}</div></>;
}

function SettingsPage({ onNotify, configured }: { onNotify: (message: string) => void; configured: boolean }) {
  return <><PageHeading eyebrow="WORKSPACE PREFERENCES" title="Settings" description="Set the defaults you want to start with."/><div className="settings-layout"><section className="settings-section"><div className="settings-section-title"><h2>Video defaults</h2><p>Used as the starting point for new edits.</p></div><div className="settings-fields"><label className="field-label" htmlFor="default-ratio">Aspect ratio</label><select className="form-select" id="default-ratio"><option>9:16 · Shorts / Reels / TikTok</option><option>16:9 · YouTube</option><option>1:1 · Square</option></select><label className="field-label" htmlFor="default-caption">Caption style</label><select className="form-select" id="default-caption"><option>Highlight</option><option>Clean</option><option>Bold</option><option>Minimal</option><option>Creator</option><option>Modern</option></select><label className="field-label" htmlFor="default-quality">Export quality</label><select className="form-select" id="default-quality"><option>1080p</option><option>720p</option></select></div></section><section className="settings-section"><div className="settings-section-title"><h2>Clip discovery</h2><p>Guide the analysis toward your intended audience.</p></div><div className="settings-fields"><label className="field-label" htmlFor="clip-count">Number of clips <span className="label-value">5–10</span></label><input className="range-input" id="clip-count" type="range" min="5" max="10" defaultValue="7"/><label className="field-label" htmlFor="target-duration">Target duration <span className="label-value">40–60 sec</span></label><input className="range-input" id="target-duration" type="range" min="40" max="60" defaultValue="50"/><label className="field-label" htmlFor="content-style">Content style</label><select className="form-select" id="content-style"><option>General</option><option>Educational</option><option>Entertainment</option><option>Business</option><option>Podcast</option></select></div></section><section className="settings-section account-section"><div className="settings-section-title"><h2>Account & services</h2><p>Sign in and connect your processing tools.</p></div><div className="service-status-list"><div><span className="service-icon"><Settings size={15}/></span><span><strong>Supabase</strong><small>Authentication, database, and storage</small></span><span className={`service-badge ${configured ? 'connected' : ''}`}><i/>{configured ? 'Configured' : 'Not configured'}</span></div><div><span className="service-icon"><Sparkles size={15}/></span><span><strong>AI & video processing</strong><small>Transcription, analysis, and rendering</small></span><span className="service-badge"><i/>Not configured</span></div></div><button className="button button-outline" onClick={() => onNotify('See README for Supabase and provider setup instructions.')}><Settings size={14}/> Integration guide</button></section></div></>;
}

function AuthDialog({ onClose, onNotify, configured }: { onClose: () => void; onNotify: (message: string) => void; configured: boolean }) {
  const [mode, setMode] = useState('Sign in');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const result = await submitAuth(mode as 'Sign in' | 'Create account' | 'Reset password', String(form.get('email')), String(form.get('password') ?? ''));
      if (result.error) {
        onNotify(result.error);
        return;
      }
      onNotify(mode === 'Sign in' ? 'Signed in.' : mode === 'Reset password' ? 'Password reset email sent.' : 'Account created. Check your email if confirmation is enabled.');
      onClose();
    } catch {
      onNotify('Network error. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="icon-button modal-close" aria-label="Close" onClick={onClose}><X size={18}/></button><span className="brand-mark modal-brand"><AudioLines size={20}/></span><div className="eyebrow">CLIPY</div><h2 id="auth-title">Your work, in one place.</h2><p>{configured ? 'Sign in with your Supabase project.' : 'Connect Supabase to enable account access.'}</p><div className="auth-tabs">{['Sign in', 'Create account', 'Reset password'].map((tab) => <button type="button" key={tab} className={mode === tab ? 'active' : ''} onClick={() => setMode(tab)}>{tab}</button>)}</div><form onSubmit={submit}><label className="field-label" htmlFor="auth-email">Email</label><input className="text-input" id="auth-email" name="email" type="email" placeholder="you@example.com" required/><label className="field-label" htmlFor="auth-password">Password</label><input className="text-input" id="auth-password" name="password" type="password" placeholder="At least 8 characters" required={mode !== 'Reset password'}/><button className="button button-primary full-button" type="submit" disabled={submitting}>{submitting ? 'Working...' : mode}</button></form><div className="provider-warning auth-warning"><span className="status-dot"/>{configured ? 'Email authentication is handled by Supabase.' : 'Supabase is not configured.'}</div></section></div>;
}

export default App;
