create table public.comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (
    mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain')
  ),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);

alter table public.comment_attachments enable row level security;

grant select, insert, delete on public.comment_attachments to authenticated;

create policy "Attachments are visible to canvas members"
on public.comment_attachments for select
using (
  exists (
    select 1
    from public.comments
    where comments.id = comment_attachments.comment_id
      and public.can_access_canvas(comments.canvas_id)
  )
);

create policy "Canvas members can create attachments"
on public.comment_attachments for insert
with check (
  uploader_id = auth.uid()
  and exists (
    select 1
    from public.comments
    where comments.id = comment_attachments.comment_id
      and public.can_access_canvas(comments.canvas_id)
  )
);

create policy "Attachment uploaders and canvas owners can delete attachments"
on public.comment_attachments for delete
using (
  uploader_id = auth.uid()
  or public.is_admin()
  or exists (
    select 1
    from public.comments
    join public.canvases on canvases.id = comments.canvas_id
    where comments.id = comment_attachments.comment_id
      and canvases.owner_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comment-attachments',
  'comment-attachments',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Canvas members can read comment attachments"
on storage.objects for select
using (
  bucket_id = 'comment-attachments'
  and public.can_access_canvas((storage.foldername(name))[1]::uuid)
);

create policy "Canvas members can upload safe comment attachments"
on storage.objects for insert
with check (
  bucket_id = 'comment-attachments'
  and public.can_access_canvas((storage.foldername(name))[1]::uuid)
  and lower(storage.extension(name)) in ('png', 'jpg', 'jpeg', 'gif', 'webp', 'txt')
);

create policy "Canvas members can delete comment attachments"
on storage.objects for delete
using (
  bucket_id = 'comment-attachments'
  and public.can_access_canvas((storage.foldername(name))[1]::uuid)
);
