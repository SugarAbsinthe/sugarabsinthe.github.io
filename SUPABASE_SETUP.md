# Supabase Setup For Multi-Device Sync

This project is still a static website. Supabase provides auth + database.

## 1. Create a Supabase project

1. Open `https://supabase.com`.
2. Create a new project.
3. In project settings, copy:
   - `Project URL`
   - `anon public key`

## 2. Fill local config

Edit [`supabase-config.js`](./supabase-config.js):

```js
window.SUPABASE_CONFIG = {
  enabled: true,
  url: "https://YOUR_PROJECT_ID.supabase.co",
  anonKey: "YOUR_ANON_KEY",
  postsTable: "blog_posts",
  profileTable: "blog_profiles"
};
```

## 3. Create tables and RLS policies

Run the SQL below in Supabase SQL editor:

```sql
create table if not exists public.blog_posts (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id text not null,
  title text not null,
  content text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.blog_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  title text not null default 'About Me',
  quote text not null default 'Live like summer flowers.',
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.blog_posts enable row level security;
alter table public.blog_profiles enable row level security;

drop policy if exists "posts_select_own" on public.blog_posts;
drop policy if exists "posts_insert_own" on public.blog_posts;
drop policy if exists "posts_update_own" on public.blog_posts;
drop policy if exists "posts_delete_own" on public.blog_posts;

create policy "posts_select_own"
on public.blog_posts for select
using (auth.uid() = user_id);

create policy "posts_insert_own"
on public.blog_posts for insert
with check (auth.uid() = user_id);

create policy "posts_update_own"
on public.blog_posts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "posts_delete_own"
on public.blog_posts for delete
using (auth.uid() = user_id);

drop policy if exists "profiles_select_own" on public.blog_profiles;
drop policy if exists "profiles_insert_own" on public.blog_profiles;
drop policy if exists "profiles_update_own" on public.blog_profiles;
drop policy if exists "profiles_delete_own" on public.blog_profiles;

create policy "profiles_select_own"
on public.blog_profiles for select
using (auth.uid() = user_id);

create policy "profiles_insert_own"
on public.blog_profiles for insert
with check (auth.uid() = user_id);

create policy "profiles_update_own"
on public.blog_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "profiles_delete_own"
on public.blog_profiles for delete
using (auth.uid() = user_id);
```

## 4. Enable email login

In Supabase Auth settings:

1. Enable Email provider.
2. Use Magic Link sign-in.
3. Add your site URL and redirect URL (for local dev and production).

## 5. Usage in this blog

1. Open homepage.
2. Enter email and click `Send Magic Link`.
3. Open login email and return to homepage.
4. Click `Sync Now` once after first login on each device.

After that, note save/delete/profile update will try cloud sync automatically.
