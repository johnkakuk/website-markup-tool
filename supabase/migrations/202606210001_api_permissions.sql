grant usage on schema public to authenticated;

grant select, insert, update, delete
on table
  public.profiles,
  public.canvases,
  public.canvas_users,
  public.comments,
  public.replies
to authenticated;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.can_access_canvas(uuid) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_canvas(uuid) to authenticated;

drop policy "Users can update their own profile" on public.profiles;

drop policy "Authenticated users can create owned canvases" on public.canvases;

create policy "Admins can create owned canvases"
on public.canvases for insert
with check (auth.uid() = owner_id and public.is_admin());
