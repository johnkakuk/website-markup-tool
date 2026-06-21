alter table public.comment_attachments
drop constraint if exists comment_attachments_mime_type_check;

alter table public.comment_attachments
add constraint comment_attachments_mime_type_check check (
  mime_type in (
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  )
);

update storage.buckets
set allowed_mime_types = array[
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip'
]
where id = 'comment-attachments';

drop policy "Canvas members can upload safe comment attachments" on storage.objects;

create policy "Canvas members can upload safe comment attachments"
on storage.objects for insert
with check (
  bucket_id = 'comment-attachments'
  and public.can_access_canvas((storage.foldername(name))[1]::uuid)
  and lower(storage.extension(name)) in (
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'docx', 'xlsx', 'pptx', 'zip'
  )
);
