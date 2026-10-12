-- Run this in the Supabase SQL editor. SI Code does not ship a service role key.
-- Google provider (client id and secret) is configured in Authentication → Providers → Google.
-- Google authorized redirect: https://<project-ref>.supabase.co/auth/v1/callback
-- Additional redirect URLs:
--   http://127.0.0.1:33418/auth/callback
--   sicode://auth/callback

create table if not exists public.user_settings (
	user_id uuid primary key references auth.users (id) on delete cascade,
	settings jsonb not null default '{}'::jsonb,
	updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "own settings"
	on public.user_settings
	for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('user-files', 'user-files', false)
on conflict (id) do nothing;

create policy "own files"
	on storage.objects
	for all
	using (
		bucket_id = 'user-files'
		and (storage.foldername(name))[1] = auth.uid()::text
	)
	with check (
		bucket_id = 'user-files'
		and (storage.foldername(name))[1] = auth.uid()::text
	);
