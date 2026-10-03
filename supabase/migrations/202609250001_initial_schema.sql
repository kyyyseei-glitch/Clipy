create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  source_type text not null check (source_type in ('upload', 'youtube')),
  storage_path text,
  source_url text,
  original_name text,
  rights_confirmed boolean not null default false,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  processing_status text not null default 'queued' check (processing_status in ('queued', 'processing', 'ready', 'failed')),
  failure_code text,
  created_at timestamptz not null default now(),
  constraint video_source_present check (storage_path is not null or source_url is not null)
);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  start_seconds numeric(10, 3) not null check (start_seconds >= 0),
  end_seconds numeric(10, 3) not null,
  ai_content_score smallint check (ai_content_score between 0 and 100),
  topic text,
  category text not null default 'Interesting',
  status text not null default 'suggested' check (status in ('suggested', 'edited', 'rendering', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  constraint clip_has_duration check (end_seconds > start_seconds)
);

create table public.clip_metadata (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  clip_id uuid not null unique references public.clips (id) on delete cascade,
  suggested_title text,
  description text,
  hashtags text[] not null default '{}',
  hook text,
  social_caption text,
  transcript text,
  updated_at timestamptz not null default now()
);

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  format text not null default 'mp4' check (format in ('mp4')),
  resolution text not null default '1080p' check (resolution in ('720p', '1080p')),
  storage_path text,
  status text not null default 'queued' check (status in ('queued', 'rendering', 'ready', 'failed')),
  failure_code text,
  created_at timestamptz not null default now()
);

create table public.usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  period_start date not null,
  videos_processed integer not null default 0 check (videos_processed >= 0),
  processing_seconds integer not null default 0 check (processing_seconds >= 0),
  credits_used integer not null default 0 check (credits_used >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, period_start)
);

create index projects_owner_updated_idx on public.projects (owner_id, updated_at desc);
create index videos_project_created_idx on public.videos (project_id, created_at desc);
create index clips_project_created_idx on public.clips (project_id, created_at desc);
create index exports_owner_created_idx on public.exports (owner_id, created_at desc);

create or replace function public.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_user_profile();

alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.videos enable row level security;
alter table public.clips enable row level security;
alter table public.clip_metadata enable row level security;
alter table public.exports enable row level security;
alter table public.usage enable row level security;

create policy "Users can read own profile" on public.users for select to authenticated using (id = (select auth.uid()));
create policy "Users can update own profile" on public.users for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Users can manage own projects" on public.projects for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Users can manage own videos" on public.videos for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Users can manage own clips" on public.clips for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Users can manage own clip metadata" on public.clip_metadata for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Users can manage own exports" on public.exports for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Users can read own usage" on public.usage for select to authenticated using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public)
values ('source-videos', 'source-videos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('clip-exports', 'clip-exports', false)
on conflict (id) do nothing;

create policy "Users can upload own source videos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'source-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can read own source videos" on storage.objects
  for select to authenticated
  using (bucket_id = 'source-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can delete own source videos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'source-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can upload own clip exports" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'clip-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can read own clip exports" on storage.objects
  for select to authenticated
  using (bucket_id = 'clip-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
