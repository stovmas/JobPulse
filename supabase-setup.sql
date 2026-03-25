-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- This creates the table for storing user settings.

-- 1. Create the user_settings table
create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique not null,
  settings jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Enable Row Level Security so users can only access their own data
alter table public.user_settings enable row level security;

-- 3. Policies: users can only read/write their own row
create policy "Users can read own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own settings"
  on public.user_settings for update
  using (auth.uid() = user_id);

-- 4. Auto-update the updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_user_settings_update
  before update on public.user_settings
  for each row execute function public.handle_updated_at();
