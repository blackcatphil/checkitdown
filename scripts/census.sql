-- THE CENSUS: every column test:mixed is capable of moving.
--
-- Read before the suite and again after; the gate is a DIFF, not a set of
-- expected numbers. Baselines change every time a floor visit lands, and a
-- hardcoded one goes stale silently — the failure this project keeps finding.
--
-- Verification is per FACT, not per room. `rooms.verified_at` alone was the
-- old check, and it is NULL on all seventeen rooms while 6 games, 33 rakes,
-- 30 amenity rows and 2 formats carry real stamps: a broken rollback could
-- have wiped every one of them and reported a clean database.
--
-- ADD A ROW HERE whenever a scenario learns to touch a new column.
select 'rooms.verified',        count(*) filter (where verified_at is not null)      from rooms
union all
select 'rooms.total',           count(*)                                             from rooms
union all
select 'games.verified',        count(*) filter (where verified_at is not null)      from cash_games
union all
select 'games.rake_verified',   count(*) filter (where rake_verified_at is not null) from cash_games
union all
select 'games.total',           count(*)                                             from cash_games
union all
select 'amenities.verified',    count(*) filter (where verified_at is not null)      from room_amenities
union all
select 'amenities.available',   count(*) filter (where available)                    from room_amenities
union all
select 'amenities.total',       count(*)                                             from room_amenities
union all
select 'house_rules.verified',  count(*) filter (where verified_at is not null)      from house_rules
union all
select 'house_rules.total',     count(*)                                             from house_rules
union all
select 'formats.verified',      count(*) filter (where verified_at is not null)      from room_formats
union all
select 'waitlist.total',        count(*)                                             from room_waitlist
order by 1;
