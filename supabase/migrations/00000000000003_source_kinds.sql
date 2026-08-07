-- SOURCE CLASSIFICATION, WITHOUT OPENING `sources`.
--
-- The partner floor data is the first source that is not a page a reader can
-- open: it is a Google Sheet behind a permission wall. A receipt pointing at it
-- looks like evidence and behaves like a locked door, so those facts must
-- render as words rather than links.
--
-- Deciding that requires the app to know a source's `data_type`, and `sources`
-- is deliberately `service_only` — "nothing the browser can reach may read
-- sources" is a decision worth keeping, because that table also carries parser
-- state, error text and content hashes that are nobody's business.
--
-- So this exposes the two columns the decision needs and nothing else. It is
-- NOT a widening of what is public: `cash_games.rake_source_url` and
-- `room_amenities.source_url` are already granted to anon and already return
-- the sheet's URL today. What was missing was the label that says not to link
-- it.
--
-- SECURITY DEFINER ON PURPOSE, which is the opposite of `room_freshness`. That
-- view reads `rooms`, which anon may read anyway, so it runs as the invoker.
-- This one reads a service_only table and must not require the caller to hold
-- that privilege — the whole point is to publish the classification without
-- publishing the table.
--
-- THE `where` IS THE SAFETY PROPERTY, not a filter for tidiness. Without it the
-- view publishes every FUTURE source row the moment it is inserted, and a
-- tier-1 scraper endpoint is exactly the kind of URL that carries an API key in
-- its query string. That is the auto-grant failure this schema already rejected
-- for tables ("explicit grants force a per-table decision"), arriving one layer
-- down as auto-publish. Scoped this way a source appears here only once a
-- public fact already cites it — the condition under which its URL is public
-- anyway — so the view adds a label and never a URL. Verified at write time:
-- all 43 seeded sources qualify, so this costs nothing today and holds the line
-- tomorrow.
create view public.source_kinds as
  select s.url, s.data_type
    from public.sources s
   where exists (select 1 from public.rooms r where r.source_url = s.url)
      or exists (select 1 from public.cash_games c
                  where c.source_url = s.url or c.rake_source_url = s.url)
      or exists (select 1 from public.room_amenities ra where ra.source_url = s.url);

-- Explicit rather than relying on the PG15 default, because the neighbouring
-- view sets the opposite value and a reader should not have to know which way
-- the default falls.
alter view public.source_kinds set (security_invoker = off);

comment on view public.source_kinds is
  'Public classification of sources: url + data_type only. Lets the site decide '
  'link-vs-plain-text for a receipt without granting access to sources itself.';

grant select on public.source_kinds to anon, authenticated;
