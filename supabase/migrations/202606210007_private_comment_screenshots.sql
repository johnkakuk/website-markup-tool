alter table public.comments
add column screenshot_path text;

update public.comments
set screenshot_path = canvas_id::text || '/' || id::text || '.png'
where screenshot_url is not null;

update storage.buckets
set public = false
where id = 'comment-screenshots';

drop policy "Authenticated users can read comment screenshots" on storage.objects;
drop policy "Authenticated users can upload comment screenshots" on storage.objects;
drop policy "Authenticated users can replace comment screenshots" on storage.objects;

create policy "Canvas members can read comment screenshots"
on storage.objects for select
using (
  bucket_id = 'comment-screenshots'
  and public.can_access_canvas((storage.foldername(name))[1]::uuid)
);

create policy "Canvas members can upload comment screenshots"
on storage.objects for insert
with check (
  bucket_id = 'comment-screenshots'
  and public.can_access_canvas((storage.foldername(name))[1]::uuid)
);

create policy "Canvas members can replace comment screenshots"
on storage.objects for update
using (
  bucket_id = 'comment-screenshots'
  and public.can_access_canvas((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'comment-screenshots'
  and public.can_access_canvas((storage.foldername(name))[1]::uuid)
);
