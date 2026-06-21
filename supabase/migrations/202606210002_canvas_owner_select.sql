drop policy "Accessible canvases are visible" on public.canvases;

create policy "Accessible canvases are visible"
on public.canvases for select
using (
  owner_id = auth.uid()
  or public.can_access_canvas(id)
);
