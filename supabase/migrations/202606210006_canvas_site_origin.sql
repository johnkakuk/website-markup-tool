alter table public.canvases
add column site_origin text;

update public.canvases
set site_origin = substring(site_url from '^(https?://[^/]+)');

alter table public.canvases
alter column site_origin set not null;

alter table public.canvases
add constraint canvases_site_origin_format check (
  site_origin ~ '^https?://[^/?#]+$'
);

create index canvases_site_origin_idx on public.canvases (site_origin);

grant select on public.canvases to service_role;
