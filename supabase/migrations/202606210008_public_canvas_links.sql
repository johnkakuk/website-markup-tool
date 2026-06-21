alter table public.canvases
add column share_token uuid not null default gen_random_uuid();

alter table public.canvases
add constraint canvases_share_token_unique unique (share_token);

create or replace function public.requested_canvas_share_token()
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  token text;
begin
  token := current_setting('request.headers', true)::jsonb ->> 'x-canvas-share-token';
  return nullif(token, '')::uuid;
exception
  when others then
    return null;
end;
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
        or c.share_token = public.requested_canvas_share_token()
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    coalesce(new.email, 'anonymous+' || new.id::text || '@local.invalid'),
    'client'
  )
  on conflict (id) do update set email = excluded.email;

  if new.email is not null then
    update public.canvas_users
    set user_id = new.id
    where user_id is null and lower(email) = lower(new.email);
  end if;

  return new;
end;
$$;

revoke execute on function public.requested_canvas_share_token() from public, anon;
grant execute on function public.requested_canvas_share_token() to authenticated;
