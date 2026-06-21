create policy "Canvas members can delete comment screenshots"
on storage.objects for delete
using (
  bucket_id = 'comment-screenshots'
  and public.can_access_canvas((storage.foldername(name))[1]::uuid)
);
