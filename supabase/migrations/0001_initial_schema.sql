create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'client');
create type public.comment_status as enum ('open', 'resolved');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role public.user_role not null default 'client',
  created_at timestamptz not null default now()
);

create table public.canvases (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  site_url text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.canvas_users (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid not null references public.canvases(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  constraint canvas_users_has_user_or_email check (user_id is not null or email is not null)
);

create unique index canvas_users_canvas_user_unique
  on public.canvas_users (canvas_id, user_id)
  where user_id is not null;

create unique index canvas_users_canvas_email_unique
  on public.canvas_users (canvas_id, lower(email))
  where email is not null;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid not null references public.canvases(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  element_selector text,
  element_id text,
  data_selector text,
  xpath text,
  x_pct numeric(7,4) not null,
  y_pct numeric(7,4) not null,
  viewport_width integer not null,
  page_path text not null default '/',
  body text not null,
  screenshot_url text,
  status public.comment_status not null default 'open',
  created_at timestamptz not null default now()
);

create table public.replies (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'client')
  on conflict (id) do update set email = excluded.email;

  update public.canvas_users
  set user_id = new.id
  where user_id is null and lower(email) = lower(new.email);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.can_access_canvas(canvas_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.canvases c
    where c.id = canvas_uuid
      and (
        c.owner_id = auth.uid()
        or public.is_admin()
        or exists (
          select 1
          from public.canvas_users cu
          where cu.canvas_id = c.id
            and (
              cu.user_id = auth.uid()
              or lower(cu.email) = lower(auth.jwt() ->> 'email')
            )
        )
      )
  );
$$;

alter table public.profiles enable row level security;
alter table public.canvases enable row level security;
alter table public.canvas_users enable row level security;
alter table public.comments enable row level security;
alter table public.replies enable row level security;

create policy "Profiles are visible to self and admins"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "Users can update their own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "Accessible canvases are visible"
on public.canvases for select
using (public.can_access_canvas(id));

create policy "Authenticated users can create owned canvases"
on public.canvases for insert
with check (auth.uid() = owner_id);

create policy "Owners can update canvases"
on public.canvases for update
using (auth.uid() = owner_id or public.is_admin())
with check (auth.uid() = owner_id or public.is_admin());

create policy "Owners can delete canvases"
on public.canvases for delete
using (auth.uid() = owner_id or public.is_admin());

create policy "Canvas users are visible to canvas members"
on public.canvas_users for select
using (public.can_access_canvas(canvas_id));

create policy "Canvas owners can link clients"
on public.canvas_users for insert
with check (
  exists (
    select 1 from public.canvases
    where id = canvas_id and (owner_id = auth.uid() or public.is_admin())
  )
);

create policy "Canvas owners can update client links"
on public.canvas_users for update
using (
  exists (
    select 1 from public.canvases
    where id = canvas_id and (owner_id = auth.uid() or public.is_admin())
  )
)
with check (
  exists (
    select 1 from public.canvases
    where id = canvas_id and (owner_id = auth.uid() or public.is_admin())
  )
);

create policy "Canvas owners can delete client links"
on public.canvas_users for delete
using (
  exists (
    select 1 from public.canvases
    where id = canvas_id and (owner_id = auth.uid() or public.is_admin())
  )
);

create policy "Comments are visible to canvas members"
on public.comments for select
using (public.can_access_canvas(canvas_id));

create policy "Canvas members can create comments"
on public.comments for insert
with check (author_id = auth.uid() and public.can_access_canvas(canvas_id));

create policy "Authors and owners can update comments"
on public.comments for update
using (
  author_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.canvases
    where id = canvas_id and owner_id = auth.uid()
  )
)
with check (
  author_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.canvases
    where id = canvas_id and owner_id = auth.uid()
  )
);

create policy "Authors and owners can delete comments"
on public.comments for delete
using (
  author_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.canvases
    where id = canvas_id and owner_id = auth.uid()
  )
);

create policy "Replies are visible to canvas members"
on public.replies for select
using (
  exists (
    select 1 from public.comments
    where comments.id = replies.comment_id
      and public.can_access_canvas(comments.canvas_id)
  )
);

create policy "Canvas members can create replies"
on public.replies for insert
with check (
  author_id = auth.uid()
  and exists (
    select 1 from public.comments
    where comments.id = replies.comment_id
      and public.can_access_canvas(comments.canvas_id)
  )
);

create policy "Reply authors can update replies"
on public.replies for update
using (author_id = auth.uid() or public.is_admin())
with check (author_id = auth.uid() or public.is_admin());

create policy "Reply authors can delete replies"
on public.replies for delete
using (author_id = auth.uid() or public.is_admin());

insert into storage.buckets (id, name, public)
values ('comment-screenshots', 'comment-screenshots', true)
on conflict (id) do update set public = excluded.public;

create policy "Authenticated users can read comment screenshots"
on storage.objects for select
using (bucket_id = 'comment-screenshots' and auth.role() = 'authenticated');

create policy "Authenticated users can upload comment screenshots"
on storage.objects for insert
with check (bucket_id = 'comment-screenshots' and auth.role() = 'authenticated');

create policy "Authenticated users can replace comment screenshots"
on storage.objects for update
using (bucket_id = 'comment-screenshots' and auth.role() = 'authenticated')
with check (bucket_id = 'comment-screenshots' and auth.role() = 'authenticated');
