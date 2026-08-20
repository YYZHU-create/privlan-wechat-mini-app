alter table users add column if not exists avatar_url text;

create index if not exists users_display_name_idx on users(display_name);
