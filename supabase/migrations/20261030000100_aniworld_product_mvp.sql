-- ANIWorld product MVP: user accounts, library and cross-device watch progress.
-- All user-owned data is protected by Row Level Security.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default 'Аниме-фанат'
    check (char_length(display_name) between 1 and 64),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watchlist (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'aniliberty'
    check (provider ~ '^[a-z0-9_-]{2,40}$'),
  provider_code text not null
    check (char_length(provider_code) between 1 and 180),
  title text not null
    check (char_length(title) between 1 and 240),
  kind text not null default 'anime'
    check (kind in ('anime', 'manga')),
  synopsis text,
  poster_url text,
  release_year integer check (release_year is null or release_year between 1900 and 2200),
  score numeric(3,1) check (score is null or score between 0 and 10),
  genres text[] not null default '{}',
  status text not null default 'planned'
    check (status in ('planned', 'watching', 'completed', 'on_hold', 'dropped')),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, provider_code)
);

create index if not exists watchlist_user_status_updated_idx
  on public.watchlist (user_id, status, updated_at desc);

create table if not exists public.watch_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'aniliberty'
    check (provider ~ '^[a-z0-9_-]{2,40}$'),
  provider_code text not null
    check (char_length(provider_code) between 1 and 180),
  title text not null
    check (char_length(title) between 1 and 240),
  episode_number integer not null check (episode_number > 0),
  voice text not null default '',
  position_seconds numeric(12,3) not null default 0 check (position_seconds >= 0),
  duration_seconds numeric(12,3) not null default 0 check (duration_seconds >= 0),
  is_finished boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, provider_code, episode_number, voice)
);

create index if not exists watch_progress_user_updated_idx
  on public.watch_progress (user_id, updated_at desc);

create or replace function public.aniworld_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.aniworld_set_updated_at();

drop trigger if exists watchlist_set_updated_at on public.watchlist;
create trigger watchlist_set_updated_at
before update on public.watchlist
for each row execute function public.aniworld_set_updated_at();

drop trigger if exists watch_progress_set_updated_at on public.watch_progress;
create trigger watch_progress_set_updated_at
before update on public.watch_progress
for each row execute function public.aniworld_set_updated_at();

create or replace function public.aniworld_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_username text;
  candidate text;
  suffix integer := 0;
begin
  base_username := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^a-z0-9_]+', '', 'g'));
  if char_length(base_username) < 3 then
    base_username := 'ani_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  base_username := left(base_username, 24);

  loop
    candidate := case
      when suffix = 0 then base_username
      else left(base_username, 24 - char_length(suffix::text) - 1) || '_' || suffix::text
    end;
    exit when not exists (select 1 from public.profiles p where p.username = candidate);
    suffix := suffix + 1;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'Аниме-фанат'), 64)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.aniworld_handle_new_user() from public, anon, authenticated;
revoke all on function public.aniworld_set_updated_at() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_aniworld on auth.users;
create trigger on_auth_user_created_aniworld
after insert on auth.users
for each row execute function public.aniworld_handle_new_user();

alter table public.profiles enable row level security;
alter table public.watchlist enable row level security;
alter table public.watch_progress enable row level security;

drop policy if exists "profiles_read_own" on public.profiles;
create policy "profiles_read_own"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "watchlist_select_own" on public.watchlist;
create policy "watchlist_select_own"
on public.watchlist for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "watchlist_insert_own" on public.watchlist;
create policy "watchlist_insert_own"
on public.watchlist for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "watchlist_update_own" on public.watchlist;
create policy "watchlist_update_own"
on public.watchlist for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "watchlist_delete_own" on public.watchlist;
create policy "watchlist_delete_own"
on public.watchlist for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "watch_progress_select_own" on public.watch_progress;
create policy "watch_progress_select_own"
on public.watch_progress for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "watch_progress_insert_own" on public.watch_progress;
create policy "watch_progress_insert_own"
on public.watch_progress for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "watch_progress_update_own" on public.watch_progress;
create policy "watch_progress_update_own"
on public.watch_progress for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "watch_progress_delete_own" on public.watch_progress;
create policy "watch_progress_delete_own"
on public.watch_progress for delete to authenticated
using ((select auth.uid()) = user_id);

-- Least-privilege table grants. The public schema/tables must also be explicitly
-- exposed to the Data API in Supabase project settings before browser access.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.watchlist to authenticated;
grant select, insert, update, delete on public.watch_progress to authenticated;
