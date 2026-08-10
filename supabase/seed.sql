-- =====================================================================
-- CHECK IT DOWN — v1 seed: CANDIDATE DATA
-- =====================================================================
-- Research pass of 2026-08-03. Read the rule before editing this file:
--
--   * Every row carries source_url and fetched_at.
--   * verified_at IS NULL on every row in this file, without exception.
--     Nothing here has been confirmed by a human on site. A web search is
--     not verification. The UI shows these tilde'd, dotted, never ranked.
--   * A field that could not be sourced to a URL is left NULL. It is not
--     inferred, averaged, or filled from the model's own knowledge.
--     The NULLs are the deliverable: they are the in-person to-do list.
--
-- Roster: the 17 permanent valley rooms per Vegas Advantage's open-rooms
-- list (2026-03-04). Paris/WSOP is the 18th and is deliberately absent,
-- and "absent" means ABSENT: there is no row for it and never has been.
--
-- An earlier note here said it was is_seasonal and off the roster by
-- default, which described a row that was never written. Phil ruled on
-- 2026-08-07 that WSOP stays out of the roster entirely and gets its own
-- dedicated page when the series comes round next year — a different
-- surface with a different shape, not a room hidden behind a flag. That
-- supersedes the 2026-08-03 "seed it as seasonal" ruling.
--
-- The is_seasonal COLUMN and every branch reading it stay. A seasonal
-- room is a real future case, the branch is already proven by test:mixed,
-- and removing it would trade a tested path for an untested one on the
-- day a series room finally arrives.
--
-- ---------------------------------------------------------------------
-- CONFLICTS, AND HOW THEY WERE ADJUDICATED
-- All five are on the floor-visit list. None were merged.
--
--   Green Valley Ranch tables  15 (Vegas Advantage) vs 20 (Station) -> 15
--       Station's GVR and Red Rock pages carry byte-identical text, which
--       reads as copy-paste boilerplate rather than two measurements.
--   Westgate tables             7 (official) vs 6 (VA)              -> 7
--   Orleans tables             35 (Boyd official) vs 34 (PokerAtlas) -> 35
--   Skyline days               Thu/Fri/Sat vs Mon/Fri/Sat/Sun        -> the
--       one readable at source; Skyline's own per-room page 404s.
--   Westgate game list          official lists 3/6 limit and omits 1/3
--       no-limit and 4/8 limit; VA lists the reverse            -> VA's list
--
-- NOTE THE ASYMMETRY, and do not read it as a precedent: we took OFFICIAL
-- over VA for table counts, then VA over OFFICIAL for Westgate's game
-- list. The reasoning, not a rule: official pages are reliable for static
-- property facts and are frequently stale on game lists, and a 7-table
-- room spreading only 3/6 limit is implausible. It is judgement, and the
-- floor visit settles it.
--
-- Underlying principle for game lists: FALSE PRESENCE IS WORSE THAN FALSE
-- ABSENCE. Omitting a game someone could have played is a mild loss.
-- Listing a game that is not spread sends someone across town for
-- nothing, and that is the failure that costs trust. So 3/6 is NOT added
-- "just in case" — absence is the safer error.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- MARKET
-- ---------------------------------------------------------------------
insert into markets (slug, name, timezone)
values ('las-vegas', 'Las Vegas', 'America/Los_Angeles');

-- ---------------------------------------------------------------------
-- SOURCES
-- One row per (room x data-type x URL). This is also the maintenance
-- loop's to-do list, so the parser column stays NULL: nothing here has a
-- tier-1 parser yet, every one of these was read by hand.
-- ---------------------------------------------------------------------
insert into sources (data_type, url, label, cadence_hours, status, last_fetched_at, last_ok_at) values
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/','Vegas Advantage — open Las Vegas poker rooms (roster)',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/aria/','Vegas Advantage — ARIA',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/bellagio/','Vegas Advantage — Bellagio',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/boulder-station/','Vegas Advantage — Boulder Station',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/caesars-palace/','Vegas Advantage — Caesars Palace',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/golden-nugget/','Vegas Advantage — Golden Nugget',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/green-valley-ranch/','Vegas Advantage — Green Valley Ranch',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/horseshoe/','Vegas Advantage — Horseshoe',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/mandalay-bay/','Vegas Advantage — Mandalay Bay',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/mgm-grand/','Vegas Advantage — MGM Grand',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/red-rock/','Vegas Advantage — Red Rock',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/santa-fe-station/','Vegas Advantage — Santa Fe Station',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/south-point/','Vegas Advantage — South Point',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/','Vegas Advantage — Venetian',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/wynn/','Vegas Advantage — Wynn/Encore',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://orleans.boydgaming.com/play/poker-room','The Orleans — official poker room page (Boyd)',168,'ok','2026-08-03','2026-08-03'),
  ('rooms','https://www.westgateresorts.com/hotels/nevada/las-vegas/westgate-las-vegas-resort-casino/casino/poker/','Westgate — official poker room page',168,'ok','2026-08-03','2026-08-03'),
  -- Westgate needs both: the official page carries the room facts (7 tables,
  -- hours, phone) but no stakes we used and no rake at all.
  ('rooms','https://vegasadvantage.com/open-las-vegas-poker-rooms/westgate/','Vegas Advantage — Westgate',168,'ok','2026-08-03','2026-08-03');

-- Cash-game sources reuse the same pages under a second data_type, because
-- the schema keys sources on (url, data_type) and the maintenance loop
-- treats "the rake changed" and "the room closed" as different jobs.
insert into sources (data_type, url, label, cadence_hours, status, last_fetched_at, last_ok_at)
select 'cash', url, label, 72, status, last_fetched_at, last_ok_at
from sources where data_type = 'rooms';

-- ---------------------------------------------------------------------
-- ROOMS — all 17.
--
-- latitude/longitude: OpenStreetMap via Nominatim, each hit checked by
-- name before acceptance. This mattered: "Venetian" first resolved to
-- Sphere and "Orleans" to Harrah's New Orleans, Louisiana. Both were
-- rejected and re-queried. NOTE these are PROPERTY centroids, not the
-- poker room's position inside the property — on a site the size of MGM
-- Grand that is a few hundred metres of error, so they are candidate
-- data like everything else here.
--
-- area: DERIVED, not sourced. It is our own classification. The strip
-- assignment is corroborated — Vegas Advantage states eight Strip rooms
-- remain after Resorts World closed, and exactly eight are marked strip
-- here — but off_strip vs locals is an editorial judgement call.
-- ---------------------------------------------------------------------
insert into rooms (
  market_id, slug, name, property, area, status,
  latitude, longitude, table_count, phone, website_url,
  hours_note, is_24h, loyalty_program, comp_rate_hourly, comp_notes,
  source_url
)
-- fetched_at is stamped below; verified_at is never set in this file.

select m.id, v.* from markets m,
(values
  ('aria','ARIA','ARIA Resort & Casino','strip'::area_kind,'open'::room_status,
    36.107029,-115.177998,24,null,'https://aria.mgmresorts.com/en/casino/poker.html',
    '24 hours',true,'MGM Rewards',2.00,'$2/hr; $3/hr at 5/10 no-limit',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/aria/'),

  ('bellagio','Bellagio','Bellagio','strip','open',
    36.113115,-115.177007,37,null,'https://bellagio.mgmresorts.com/en/casino/poker.html',
    '24 hours',true,'MGM Rewards',2.00,'$2/hr; $3/hr at 5/10 no-limit and above. 37 tables across three rooms',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/bellagio/'),

  ('boulder-station','Boulder Station','Boulder Station Hotel & Casino','locals','open',
    36.133783,-115.085261,10,null,'https://stationcasinos.com/play/poker/',
    '24 hours',true,'Station Casinos Boarding Pass',1.00,'Room walled off from the casino floor; smoking prohibited',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/boulder-station/'),

  ('caesars-palace','Caesars Palace','Caesars Palace','strip','open',
    36.116628,-115.176757,16,null,'https://www.caesars.com/caesars-palace/casino',
    '24 hours',true,'Caesars Rewards',2.00,'$2/hr in points plus double tier credits',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/caesars-palace/'),

  ('golden-nugget','Golden Nugget','Golden Nugget Las Vegas','downtown','open',
    36.169798,-115.145791,13,null,'https://www.goldennugget.com/las-vegas/casino/poker/',
    '24 hours',true,'24K Select',2.00,null,
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/golden-nugget/'),

  ('green-valley-ranch','Green Valley Ranch','Green Valley Ranch Resort Spa Casino','locals','open',
    36.020683,-115.089697,15,null,'https://stationcasinos.com/play/poker/',
    '24 hours, seven days',true,'Station Casinos Boarding Pass',1.00,'Charging station at each seat; 20+ 75-inch TVs',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/green-valley-ranch/'),

  ('horseshoe','Horseshoe','Horseshoe Las Vegas','strip','open',
    36.113482,-115.169055,18,null,'https://www.caesars.com/horseshoe-las-vegas',
    '24 hours',true,null,null,'Hosts the WSOP each summer',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/horseshoe/'),

  ('mandalay-bay','Mandalay Bay','Mandalay Bay Resort & Casino','strip','open',
    36.092246,-115.175824,10,null,'https://mandalaybay.mgmresorts.com/en/casino.html',
    'Wed-Mon 11am-3am; closed Tuesdays',false,'MGM Rewards',2.00,null,
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/mandalay-bay/'),

  ('mgm-grand','MGM Grand','MGM Grand Las Vegas','strip','open',
    36.102789,-115.169401,17,null,'https://mgmgrand.mgmresorts.com/en/casino/poker.html',
    '24 hours, seven days',true,'MGM Rewards',2.00,null,
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/mgm-grand/'),

  ('orleans','The Orleans','The Orleans Hotel & Casino','off_strip','open',
    36.103470,-115.201374,35,'702-365-7111','https://orleans.boydgaming.com/play/poker-room',
    'Daily, 24 hours',true,null,null,null,
    'https://orleans.boydgaming.com/play/poker-room'),

  ('red-rock','Red Rock Resort','Red Rock Casino Resort Spa','locals','open',
    36.156842,-115.333559,20,'702-797-7777','https://www.redrockresort.com/casino/poker/',
    '24 hours',true,'Station Casinos Boarding Pass',1.00,'Restroom inside the poker room; nine-handed tables',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/red-rock/'),

  ('santa-fe-station','Santa Fe Station','Santa Fe Station Hotel & Casino','locals','open',
    36.249887,-115.244822,14,null,'https://stationcasinos.com/play/poker/',
    '24 hours',true,'Station Casinos Boarding Pass',1.00,'Nine seats per table; next to the bowling alley',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/santa-fe-station/'),

  -- Skyline: table_count deliberately NULL. A search summary said two
  -- tables, but the per-room page 404s and the number could not be read
  -- at a source, so it is not recorded. Hours also disputed — see below.
  ('skyline','Skyline','Skyline Hotel & Casino','locals','open',
    36.062348,-115.008311,null,null,'https://skylinehotelandcasino.com/casino/',
    'Thu, Fri, Sat from 6pm',false,null,null,null,
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/'),

  ('south-point','South Point','South Point Hotel Casino Spa','off_strip','open',
    36.011939,-115.176115,30,'702-796-7111','https://southpointcasino.com/casino/poker/',
    '24 hours',true,null,null,'Discounted hotel rate at ~4 hrs of cash play per day; rate not published',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/south-point/'),

  ('venetian','Venetian','The Venetian Resort Las Vegas','strip','open',
    36.121707,-115.169335,50,null,'https://www.venetianlasvegas.com/resort/casino/poker.html',
    'Open 24 hours daily',true,'Venetian Rewards (Grazie)',2.00,'Largest room in Las Vegas — 50 tables, 14,000 sq ft. Free parking with 3 hrs play',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/'),

  ('westgate','Westgate','Westgate Las Vegas Resort & Casino','off_strip','open',
    36.135655,-115.151343,7,'702-732-5223','https://www.westgateresorts.com/hotels/nevada/las-vegas/westgate-las-vegas-resort-casino/casino/poker/',
    'Mon-Fri from 12pm, Sat-Sun from 10am, until the last game breaks',false,null,2.00,'Inside the SuperBook sportsbook area',
    'https://www.westgateresorts.com/hotels/nevada/las-vegas/westgate-las-vegas-resort-casino/casino/poker/'),

  ('wynn-encore','Wynn/Encore','Encore at Wynn Las Vegas','strip','open',
    36.128935,-115.165362,28,'702-770-7000','https://www.wynnlasvegas.com/casino/poker',
    '24 hours, seven days',true,'Wynn Red Card',1.50,'28 tables on the floor; tournament area expands to ~200. Complimentary same-day parking',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/wynn/')
) as v(slug,name,property,area,status,latitude,longitude,table_count,phone,website_url,
       hours_note,is_24h,loyalty_program,comp_rate_hourly,comp_notes,source_url);

update rooms r set fetched_at = timestamptz '2026-08-03 12:00:00-07';

update rooms r
   set source_id = s.id
  from sources s
 where s.url = r.source_url and s.data_type = 'rooms';

commit;

-- =====================================================================
-- CASH GAMES — candidate data, 11 of 17 rooms.
--
-- SIX ROOMS ARE ABSENT ON PURPOSE. rake_model_coherent requires
-- rake_percent NOT NULL for every pot-rake game, but these rooms publish
-- a CAP and no PERCENTAGE:
--     aria      — "staggered up to $6" ($1 at $10, $30, $50, $80, $120)
--     mgm-grand — "up to $6", $3 cap at four or fewer players
--     venetian  — "up to $5"
--     orleans   — "capped at $5"
--     skyline   — "caps at $3"
--     horseshoe — no rake figure published at all
-- Seeding them would mean inventing the 10%, which is the one thing this
-- pass must not do. See the note at the end of this file.
-- =====================================================================

begin;

insert into cash_games (
  room_id, game, small_blind, big_blind, small_bet, big_bet, stakes_label,
  rake_type, rake_percent, rake_cap, jackpot_drop,
  min_buy_in, max_buy_in, is_uncapped, structure_note, source_url, fetched_at
)
-- Every row here is rake_type 'pot'. No time-collection game in this pass
-- had a published rate; time rooms are on the in-person list instead.
select r.id, v.game, v.small_blind, v.big_blind, v.small_bet, v.big_bet, v.stakes_label,
       'pot'::rake_kind, v.rake_percent, v.rake_cap, v.jackpot_drop,
       v.min_buy_in, v.max_buy_in, v.is_uncapped, v.structure_note,
       -- Westgate is the exception: rooms.source_url points at Westgate's own
       -- page, but that page states neither these stakes nor any rake figure.
       -- Both were read off Vegas Advantage, so the row must cite it. (Their
       -- official page lists 3/6 limit, which Vegas Advantage does not — see
       -- the conflict list; that is a verification target, not a merge.)
       case when r.slug = 'westgate'
            then 'https://vegasadvantage.com/open-las-vegas-poker-rooms/westgate/'
            else r.source_url end,
       timestamptz '2026-08-03 12:00:00-07'
from rooms r join (values
  -- BELLAGIO — 10% up to $5; 5% up to $5 on 1/2 PLO, 2/5 NLH, 5/5 NLH;
  -- explicitly no jackpot drop, so 0.00 is a sourced fact, not a guess.
  ('bellagio','nlh'::game_kind,1,3,null,null,'$1/3',10.00,5.00,0.00,100,300,false,null),
  ('bellagio','nlh',2,5,null,null,'$2/5',5.00,5.00,0.00,200,500,false,'Reduced 5% rake'),
  ('bellagio','nlh',5,10,null,null,'$5/10',10.00,5.00,0.00,800,2500,false,null),
  ('bellagio','nlh',10,20,null,null,'$10/20',10.00,5.00,0.00,2000,8000,false,null),
  ('bellagio','plo',1,2,null,null,'$1/2 PLO',5.00,5.00,0.00,null,null,false,'Reduced 5% rake'),
  ('bellagio','plo',2,5,null,null,'$2/5 PLO',10.00,5.00,0.00,null,null,false,null),
  ('bellagio','lhe',null,null,4,8,'$4/8 limit',10.00,5.00,0.00,null,null,false,'Half-kill'),
  ('bellagio','lhe',null,null,20,40,'$20/40 limit',10.00,5.00,0.00,null,null,false,null),

  -- CAESARS PALACE — 10% up to $6
  ('caesars-palace','nlh',1,3,null,null,'$1/3',10.00,6.00,null,100,500,false,null),
  ('caesars-palace','nlh',2,5,null,null,'$2/5',10.00,6.00,null,500,2000,false,null),

  -- GOLDEN NUGGET — 10% up to $6, jackpot up to $2
  ('golden-nugget','nlh',1,2,null,null,'$1/2',10.00,6.00,2.00,null,null,true,'Uncapped buy-in'),
  ('golden-nugget','lhe',null,null,3,6,'$3/6 limit',10.00,6.00,2.00,null,null,false,null),

  -- MANDALAY BAY — 10% up to $5 plus $1 jackpot drop
  ('mandalay-bay','nlh',1,2,null,null,'$1/2',10.00,5.00,1.00,100,300,false,null),
  ('mandalay-bay','nlh',2,3,null,null,'$2/3',10.00,5.00,1.00,200,600,false,'Busy hours'),
  ('mandalay-bay','nlh',5,10,null,null,'$5/10',10.00,5.00,1.00,400,2000,false,'Busy hours'),

  -- WYNN/ENCORE — 10% up to $5, no jackpot drop
  ('wynn-encore','nlh',1,3,null,null,'$1/3',10.00,5.00,0.00,100,500,false,null),
  ('wynn-encore','nlh',2,5,null,null,'$2/5',10.00,5.00,0.00,400,1500,false,null),
  ('wynn-encore','nlh',5,10,null,null,'$5/10',10.00,5.00,0.00,1000,3000,false,null),

  -- SOUTH POINT — 10% up to $5 plus promotional drop up to $3
  ('south-point','nlh',1,2,null,null,'$1/2',10.00,5.00,3.00,100,300,false,'Min buy-in = 100x small blind'),
  ('south-point','nlh',2,3,null,null,'$2/3',10.00,5.00,3.00,200,600,false,'Min buy-in = 100x small blind'),
  ('south-point','nlh',3,5,null,null,'$3/5',10.00,5.00,3.00,300,1500,false,'Min buy-in = 100x small blind'),
  ('south-point','lhe',null,null,4,8,'$4/8 limit',10.00,5.00,3.00,null,null,false,null),
  ('south-point','lhe',null,null,8,16,'$8/16 limit',10.00,5.00,3.00,null,null,false,'Busy hours'),
  ('south-point','other',null,null,4,8,'$4/8 Omaha hi/lo',10.00,5.00,3.00,null,null,false,'Fixed-limit Omaha hi/lo'),

  -- RED ROCK — 10% up to $6 plus $2 jackpot drop
  ('red-rock','nlh',1,3,null,null,'$1/3',10.00,6.00,2.00,100,500,false,null),
  ('red-rock','nlh',3,5,null,null,'$3/5',10.00,6.00,2.00,300,1500,false,null),
  ('red-rock','lhe',null,null,4,8,'$4/8 limit',10.00,6.00,2.00,null,null,false,'$2 and $4 blinds'),

  -- GREEN VALLEY RANCH — 10% up to $5 plus promotional drop up to $3
  ('green-valley-ranch','nlh',1,3,null,null,'$1/3',10.00,5.00,3.00,100,500,false,null),
  ('green-valley-ranch','nlh',2,5,null,null,'$2/5',10.00,5.00,3.00,300,1200,false,null),
  ('green-valley-ranch','nlh',5,10,null,null,'$5/10',10.00,5.00,3.00,null,null,false,'When there is enough interest'),
  ('green-valley-ranch','lhe',null,null,4,8,'$4/8 limit',10.00,5.00,3.00,null,null,false,'Half-kill'),
  ('green-valley-ranch','other',null,null,4,8,'$4/8 Omaha',10.00,5.00,3.00,null,null,false,'When there is enough interest'),

  -- SANTA FE STATION — 10% up to $6 plus $2 jackpot drop
  ('santa-fe-station','nlh',1,2,null,null,'$1/2',10.00,6.00,2.00,100,500,false,null),
  ('santa-fe-station','nlh',2,5,null,null,'$2/5',10.00,6.00,2.00,300,2000,false,'If available'),
  ('santa-fe-station','lhe',null,null,4,8,'$4/8 limit',10.00,6.00,2.00,null,null,false,'Half-kill'),
  ('santa-fe-station','other',null,null,4,8,'$4/8 Omaha hi/lo',10.00,6.00,2.00,null,null,false,'Several nights weekly'),

  -- BOULDER STATION — 10% up to $6 plus $2 jackpot drop
  ('boulder-station','other',null,null,4,8,'$4/8 Omaha hi',10.00,6.00,2.00,null,null,false,'Half-kill; the main game'),
  ('boulder-station','other',null,null,8,16,'$8/16 Omaha hi',10.00,6.00,2.00,null,null,false,'Busy hours'),
  ('boulder-station','lhe',null,null,3,6,'$3/6 limit',10.00,6.00,2.00,null,null,false,null),
  ('boulder-station','lhe',null,null,4,8,'$4/8 limit',10.00,6.00,2.00,null,null,false,null),
  ('boulder-station','nlh',1,2,null,null,'$1/2',10.00,6.00,2.00,100,500,false,null),

  -- WESTGATE — 10% up to $5, $2 jackpot (second dollar at $30)
  ('westgate','nlh',1,2,null,null,'$1/2',10.00,5.00,2.00,100,400,false,null),
  ('westgate','nlh',1,3,null,null,'$1/3',10.00,5.00,2.00,100,400,false,null),
  ('westgate','lhe',null,null,2,4,'$2/4 limit',10.00,5.00,2.00,null,null,false,'Occasional'),
  ('westgate','lhe',null,null,4,8,'$4/8 limit',10.00,5.00,2.00,null,null,false,'Occasional')
) as v(slug,game,small_blind,big_blind,small_bet,big_bet,stakes_label,
       rake_percent,rake_cap,jackpot_drop,min_buy_in,max_buy_in,is_uncapped,structure_note)
  on r.slug = v.slug;

update cash_games c
   set source_id = s.id
  from sources s
 where s.url = c.source_url and s.data_type = 'cash';

commit;

-- =====================================================================
-- CASH GAMES — the six rooms unblocked by the amended rake constraint.
--
-- These publish a CAP but no PERCENTAGE, or nothing at all. Under the
-- amended rake_model_coherent that is now representable honestly:
-- rake_percent stays NULL rather than being invented as 10%.
--
-- Horseshoe goes further: rake_type itself is NULL, because the room
-- publishes no rake figure of any kind and asserting 'pot' would be a
-- fabrication one level up from inventing the number.
-- =====================================================================

begin;

insert into cash_games (
  room_id, game, small_blind, big_blind, small_bet, big_bet,
  is_spread_limit, spread_min, spread_max, stakes_label,
  rake_type, rake_percent, rake_cap, jackpot_drop,
  min_buy_in, max_buy_in, is_uncapped, structure_note, source_url, fetched_at,
  rake_source_url, rake_fetched_at
)
select r.id, v.game, v.small_blind, v.big_blind, v.small_bet, v.big_bet,
       v.is_spread_limit, v.spread_min, v.spread_max, v.stakes_label,
       v.rake_type, null, v.rake_cap, v.jackpot_drop,
       v.min_buy_in, v.max_buy_in, v.is_uncapped, v.structure_note,
       v.source_url, timestamptz '2026-08-03 12:00:00-07',
       -- THE ORLEANS: the only genuine split in the dataset. Stakes and
       -- buy-ins are Boyd's own page (source_url); the $5 cap appears
       -- nowhere on it and comes from the Vegas Advantage roster. The cap
       -- now cites its real source in a column something can read, rather
       -- than in a prose note nothing can.
       case when v.slug = 'orleans'
            then 'https://vegasadvantage.com/open-las-vegas-poker-rooms/' end,
       case when v.slug = 'orleans'
            then timestamptz '2026-08-03 12:00:00-07' end
from rooms r join (values
  -- ARIA — "staggered up to $6"; explicitly no jackpot drop, so 0.00 is
  -- sourced. The ladder is prose in structure_note; if enough rooms turn
  -- out to use ladders it earns a rake_tiers table, but not yet.
  ('aria','nlh'::game_kind,1,3,null,null,false,null,null,'$1/3','pot'::rake_kind,6.00,0.00,100,300,false,
   'Staggered rake to $6: $1 at $10, then $1 more at $30, $50, $80, $120',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/aria/'),
  ('aria','nlh',2,5,null,null,false,null,null,'$2/5','pot',6.00,0.00,200,1000,false,
   'Staggered rake to $6: $1 at $10, then $1 more at $30, $50, $80, $120',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/aria/'),
  ('aria','nlh',5,10,null,null,false,null,null,'$5/10','pot',6.00,0.00,400,3000,false,
   'Staggered rake to $6: $1 at $10, then $1 more at $30, $50, $80, $120',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/aria/'),
  ('aria','plo',1,2,null,null,false,null,null,'$1/2 PLO','pot',6.00,0.00,200,500,false,null,
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/aria/'),
  ('aria','plo',5,5,null,null,false,null,null,'$5/5 PLO','pot',6.00,0.00,null,null,false,'Busy hours',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/aria/'),

  -- MGM GRAND — "up to $6", $3 cap at four or fewer players, $2 drop.
  -- All games uncapped on the buy-in.
  ('mgm-grand','nlh',1,2,null,null,false,null,null,'$1/2','pot',6.00,2.00,100,null,true,
   'Rake capped at $3 with four or fewer players','https://vegasadvantage.com/open-las-vegas-poker-rooms/mgm-grand/'),
  ('mgm-grand','nlh',2,5,null,null,false,null,null,'$2/5','pot',6.00,2.00,300,null,true,
   'Rake capped at $3 with four or fewer players','https://vegasadvantage.com/open-las-vegas-poker-rooms/mgm-grand/'),
  ('mgm-grand','nlh',5,10,null,null,false,null,null,'$5/10','pot',6.00,2.00,1000,null,true,
   'Occasional. Rake capped at $3 with four or fewer players','https://vegasadvantage.com/open-las-vegas-poker-rooms/mgm-grand/'),

  -- VENETIAN — "up to $5", jackpot up to $2
  ('venetian','nlh',1,3,null,null,false,null,null,'$1/3','pot',5.00,2.00,100,300,false,null,
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/'),
  ('venetian','nlh',2,3,null,null,false,null,null,'$2/3','pot',5.00,2.00,200,600,false,null,
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/'),
  ('venetian','nlh',3,5,null,null,false,null,null,'$3/5','pot',5.00,2.00,300,1200,false,null,
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/'),
  ('venetian','nlh',5,10,null,null,false,null,null,'$5/10','pot',5.00,2.00,500,2400,false,null,
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/'),
  ('venetian','plo',1,2,null,null,false,null,null,'$1/2 PLO','pot',5.00,2.00,null,null,false,'Occasional',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/'),
  ('venetian','plo',5,5,null,null,false,null,null,'$5/5 PLO','pot',5.00,2.00,null,null,false,'Occasional',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/'),

  -- THE ORLEANS — stakes and buy-ins from the Boyd official page, which
  -- is also this row's source_url. SPLIT PROVENANCE: the $5 rake cap is
  -- NOT on the Boyd page, it comes from the Vegas Advantage roster page,
  -- so it is named in structure_note rather than silently attributed.
  ('orleans','nlh',1,2,null,null,false,null,null,'$1/2','pot',5.00,null,100,300,false,
   null,'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','nlh',2,3,null,null,false,null,null,'$2/3','pot',5.00,null,200,600,false,
   null,'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','nlh',3,5,null,null,false,null,null,'$3/5','pot',5.00,null,300,1500,false,
   null,'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','lhe',null,null,3,6,false,null,null,'$3/6 limit','pot',5.00,null,null,null,false,null,
   'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','lhe',null,null,4,8,false,null,null,'$4/8 limit','pot',5.00,null,null,null,false,'Half-kill',
   'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','lhe',null,null,8,16,false,null,null,'$8/16 limit','pot',5.00,null,null,null,false,'Half-kill',
   'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','lhe',null,null,15,30,false,null,null,'$15/30 limit','pot',5.00,null,null,null,false,'One-third kill',
   'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','other',null,null,4,8,false,null,null,'$4/8 Omaha hi/lo','pot',5.00,null,null,null,false,'Fixed limit, half-kill',
   'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','other',null,null,8,16,false,null,null,'$8/16 Omaha hi/lo','pot',5.00,null,null,null,false,'Fixed limit, half-kill',
   'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','other',null,null,15,30,false,null,null,'$15/30 Omaha hi/lo','pot',5.00,null,null,null,false,'Fixed limit, one-third kill',
   'https://orleans.boydgaming.com/play/poker-room'),
  -- the one genuine spread-limit game in the whole dataset
  ('orleans','stud',null,null,null,null,true,1,5,'$1-5 stud','pot',5.00,null,null,null,false,'Seven-card stud, spread limit',
   'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','stud',null,null,4,8,false,null,null,'$4/8 stud hi/lo','pot',5.00,null,null,null,false,'Seven-card stud hi/lo, fixed limit',
   'https://orleans.boydgaming.com/play/poker-room'),
  ('orleans','stud',null,null,12,24,false,null,null,'$12/24 stud hi/lo','pot',5.00,null,null,null,false,'Seven-card stud hi/lo, fixed limit',
   'https://orleans.boydgaming.com/play/poker-room'),

  -- SKYLINE — one game in the whole room. Rake caps at $3.
  ('skyline','lhe',null,null,2,4,false,null,null,'$2/4 limit','pot',3.00,null,null,null,false,
   'The only game spread','https://vegasadvantage.com/open-las-vegas-poker-rooms/'),

  -- HORSESHOE — publishes no rake figure of any kind. rake_type NULL.
  ('horseshoe','nlh',1,3,null,null,false,null,null,'$1/3',null,null,null,null,null,false,
   'No rake figure published','https://vegasadvantage.com/open-las-vegas-poker-rooms/horseshoe/'),
  ('horseshoe','nlh',2,3,null,null,false,null,null,'$2/3',null,null,null,null,null,false,
   'No rake figure published','https://vegasadvantage.com/open-las-vegas-poker-rooms/horseshoe/')
) as v(slug,game,small_blind,big_blind,small_bet,big_bet,is_spread_limit,spread_min,spread_max,
       stakes_label,rake_type,rake_cap,jackpot_drop,min_buy_in,max_buy_in,is_uncapped,
       structure_note,source_url)
  on r.slug = v.slug;

update cash_games c
   set source_id = s.id
  from sources s
 where s.url = c.source_url and s.data_type = 'cash' and c.source_id is null;

commit;

-- =====================================================================
-- AMENITY TYPES — reconciled against the REAL filter panel.
--
-- Source of truth: the GROUPS constant in
--   docs/design/Check It Down - Landing Map.dc.html
-- which defines 16 checkboxes across five groups. GAMES holds 4 of them
-- (nlh, plo, limit, mixed) and those are NOT amenity types — which games
-- a room spreads lives in cash_games.game, one source of truth. So the
-- amenity taxonomy is the remaining 12, exactly.
--
-- Slugs are the panel's own keys verbatim, not prettier synonyms, so the
-- filter can query these rows directly with no translation layer to drift.
-- The amenity_group enum still carries 'games'; no row uses it, and none
-- should.
-- =====================================================================

begin;

insert into amenity_types (slug, label, grp, sort_order) values
  ('tableside',   'Tableside food',   'food_drink', 1),
  ('cocktail',    'Cocktail service', 'food_drink', 2),
  ('kitchen24',   '24-hour kitchen',  'food_drink', 3),
  ('freeself',    'Free self-park',   'parking',    1),
  ('freevalet',   'Free valet',       'parking',    2),
  ('validated',   'Validated',        'parking',    3),
  ('nonsmoking',  'Non-smoking room', 'comfort',    1),
  ('usb',         'USB at seat',      'comfort',    2),
  ('tvs',         'TVs at the table', 'comfort',    3),
  ('massage',     'Massage',          'services',   1),
  ('checkcash',   'Check cashing',    'services',   2),
  ('phonein',     'Phone-in list',    'services',   3);

-- Amenity sources: same pages, third data_type. "The amenities changed"
-- is a different maintenance job again from rake or closure.
insert into sources (data_type, url, label, cadence_hours, status, last_fetched_at, last_ok_at)
select 'amenities', url, label, 336, status, last_fetched_at, last_ok_at
from sources
where data_type = 'rooms'
  and url in (
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/aria/',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/bellagio/',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/wynn/',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/green-valley-ranch/',
    'https://vegasadvantage.com/open-las-vegas-poker-rooms/boulder-station/');

-- ---------------------------------------------------------------------
-- ROOM AMENITIES — only what a source actually states.
--
-- 8 rows across 6 rooms. ELEVEN OF SEVENTEEN ROOMS GET NOTHING, and that
-- is the correct outcome, not a shortfall: amenities are the category
-- casinos publish least and the floor confirms fastest.
--
-- Rejected rather than stretched, because false presence is worse than
-- false absence:
--   Venetian "free parking with three hours of play"  -> validated, NOT
--       freeself. Free self-park means free to everyone; conditional on
--       play is a different claim and the panel separates them.
--   Golden Nugget "televisions along the walls"       -> NOT tvs. The
--       checkbox says at the table; the source says the opposite.
--   MGM Grand "noise and smoke are generally not an issue" -> NOT
--       nonsmoking. That is a description of comfort, not a policy.
--   Red Rock "restroom within the poker room"         -> no slug exists.
--       Real fact, no home in the panel. Dropped, not invented.
--   Skyline's amenity list came from a search summary of a page that
--       404s. Unreadable at source is unusable.
-- ---------------------------------------------------------------------
insert into room_amenities (room_id, amenity_id, available, detail, source_url, fetched_at)
select r.id, a.id, true, v.detail, v.source_url, timestamptz '2026-08-03 12:00:00-07'
from (values
  ('aria','cocktail',            'Quick drink service with premium options',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/aria/'),
  ('bellagio','cocktail',        'Quick drink service',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/bellagio/'),
  ('venetian','validated',       'Free parking with at least three hours of cash game or tournament action',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/'),
  ('wynn-encore','validated',    'Validated with three or more hours of action; complimentary same-day parking for poker room guests',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/wynn/'),
  ('wynn-encore','cocktail',     'Quick drink service with a wide variety',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/wynn/'),
  ('green-valley-ranch','usb',   'Each seat has a charging station',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/green-valley-ranch/'),
  ('green-valley-ranch','tvs',   'More than 20 75-inch TVs',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/green-valley-ranch/'),
  ('boulder-station','nonsmoking','Walled off from the casino floor; smoking prohibited',
   'https://vegasadvantage.com/open-las-vegas-poker-rooms/boulder-station/')
) as v(room_slug, amenity_slug, detail, source_url)
join rooms r         on r.slug = v.room_slug
join amenity_types a on a.slug = v.amenity_slug;

update room_amenities ra
   set source_id = s.id
  from sources s
 where s.url = ra.source_url and s.data_type = 'amenities';

commit;

-- =====================================================================
-- PARTNER FLOOR DATA — 2026-08-06. THE FIRST VERIFIED ROWS.
--
-- Everything above this line is CANDIDATE data: read off the web, every
-- verified_at NULL. Everything below carries verified_at SET, because it
-- came from the partner — a bracelet holder who is in these rooms
-- constantly — via his SinCityGrinders grid in Drive.
--
-- THE RULING (Phil, 2026-08-05): what he puts in the documents is law.
-- He is boots on the ground, so his data IS verification and it wins
-- every conflict against a scraped or published source, including
-- official casino pages. This amends — does not break — the seeding
-- rule's "only a human on site sets verified_at": he is that human.
--
-- DATE RULE: this first pass is stamped with the day it was applied.
-- From here, each morning's CHANGES carry that morning's date, and an
-- UNCHANGED fact keeps its ORIGINAL date so freshness ages honestly.
-- Never bulk re-stamp on a no-change morning.
--
-- His grid is registered as a `sources` row of its own (data_type
-- 'floor') rather than edited in as an unattributed change, so every
-- fact below has a receipt like every other fact in the product.
-- =====================================================================

begin;

insert into sources (data_type, url, label, cadence_hours, status, last_fetched_at, last_ok_at)
values (
  'floor',
  'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
  'Partner floor data — SinCityGrinders grid (boots on the ground)',
  24, 'ok', timestamptz '2026-08-06 12:00:00-07', timestamptz '2026-08-06 12:00:00-07'
)
on conflict (url, data_type) do nothing;

-- ---------------------------------------------------------------------
-- RAKE. His shorthand is "cap + drop": Wynn 5+0, Venetian 5+2,
-- Orleans 5+3, Santa Fe 5+3, GVR 5+3. He gives no PERCENTAGE, so
-- rake_percent is left exactly as it was — corroborating a cap is not
-- a statement about the percentage.
-- ---------------------------------------------------------------------

-- SANTA FE — a real conflict, resolved in his favour. Vegas Advantage
-- said cap $6 / drop $2; the floor says $5 / $3.
update cash_games c
   set rake_cap = 5.00, jackpot_drop = 3.00,
       rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       rake_fetched_at  = timestamptz '2026-08-06 12:00:00-07',
       rake_verified_at = timestamptz '2026-08-06 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug = 'santa-fe-station';

-- ORLEANS — a gain, not a correction: the drop was unknown, now $3.
-- His $5 cap independently corroborates the Vegas Advantage figure that
-- the Boyd page never carried (the one genuine split in the dataset).
update cash_games c
   set jackpot_drop = 3.00,
       rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       rake_fetched_at  = timestamptz '2026-08-06 12:00:00-07',
       rake_verified_at = timestamptz '2026-08-06 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug = 'orleans';

-- WYNN / VENETIAN / GVR — he AGREES with what was scraped. Values
-- unchanged; the rows become verified. Independent corroboration is
-- worth exactly as much as a correction and is recorded the same way.
update cash_games c
   set rake_verified_at = timestamptz '2026-08-06 12:00:00-07',
       rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       rake_fetched_at  = timestamptz '2026-08-06 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug in ('wynn-encore','venetian','green-valley-ranch');

commit;

-- =====================================================================
-- PARKING + TABLESIDE FOOD — the two slugs his grid fills completely.
--
-- These were the coverage failure that kept the amenity filter out of
-- v1: freeself matched ZERO rooms and tableside ZERO rooms, so a dimmed
-- pin would have meant "we never checked" while looking exactly like
-- "this room doesn't have it". His column answers both for 15 rooms,
-- including explicit NOs — and a recorded NO is a finding, not a blank.
-- =====================================================================

begin;

-- Free self-park. NOTE THE TWO ROOMS DELIBERATELY ABSENT: Wynn and
-- Venetian read "Free" on his grid, but his own long-form review says
-- the Wynn COMPS parking when you hand your ticket to the podium —
-- which is `validated`, not free-to-everyone, exactly the distinction
-- the seed already drew for Venetian. His grid is coarser than the
-- schema here; "Free" means "you don't pay", true under either slug.
-- So they get their existing validated rows VERIFIED below rather than
-- a second claim that contradicts them. GENERAL RULE: where his column
-- is coarser than a schema distinction, verify the precise row that
-- already exists instead of flattening the data to his wording.
insert into room_amenities (room_id, amenity_id, available, detail, source_url, fetched_at, verified_at)
select r.id, a.id, true, 'Free self-parking',
       'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       timestamptz '2026-08-06 12:00:00-07', timestamptz '2026-08-06 12:00:00-07'
from rooms r cross join amenity_types a
where a.slug = 'freeself'
  and r.slug in ('orleans','south-point','santa-fe-station','green-valley-ranch',
                 'red-rock','golden-nugget','westgate')
on conflict (room_id, amenity_id) do update
  set available = excluded.available, detail = excluded.detail,
      source_url = excluded.source_url, fetched_at = excluded.fetched_at,
      verified_at = excluded.verified_at;

insert into room_amenities (room_id, amenity_id, available, detail, source_url, fetched_at, verified_at)
select r.id, a.id, false, 'Paid parking — $25',
       'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       timestamptz '2026-08-06 12:00:00-07', timestamptz '2026-08-06 12:00:00-07'
from rooms r cross join amenity_types a
where a.slug = 'freeself'
  and r.slug in ('caesars-palace','bellagio','mgm-grand','aria','horseshoe','mandalay-bay')
on conflict (room_id, amenity_id) do update
  set available = excluded.available, detail = excluded.detail,
      source_url = excluded.source_url, fetched_at = excluded.fetched_at,
      verified_at = excluded.verified_at;

-- Wynn + Venetian: the validated rows seeded from the web, now confirmed
-- from the floor.
update room_amenities ra
   set verified_at = timestamptz '2026-08-06 12:00:00-07'
  from rooms r, amenity_types a
 where ra.room_id = r.id and ra.amenity_id = a.id
   and a.slug = 'validated' and r.slug in ('wynn-encore','venetian');

-- Tableside food: yes for five, an explicit no for ten.
insert into room_amenities (room_id, amenity_id, available, detail, source_url, fetched_at, verified_at)
select r.id, a.id, true, null,
       'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       timestamptz '2026-08-06 12:00:00-07', timestamptz '2026-08-06 12:00:00-07'
from rooms r cross join amenity_types a
where a.slug = 'tableside'
  and r.slug in ('wynn-encore','venetian','bellagio','south-point','aria')
on conflict (room_id, amenity_id) do update
  set available = excluded.available, source_url = excluded.source_url,
      fetched_at = excluded.fetched_at, verified_at = excluded.verified_at;

insert into room_amenities (room_id, amenity_id, available, detail, source_url, fetched_at, verified_at)
select r.id, a.id, false, null,
       'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       timestamptz '2026-08-06 12:00:00-07', timestamptz '2026-08-06 12:00:00-07'
from rooms r cross join amenity_types a
where a.slug = 'tableside'
  and r.slug in ('caesars-palace','orleans','mgm-grand','santa-fe-station',
                 'green-valley-ranch','red-rock','golden-nugget','horseshoe',
                 'mandalay-bay','westgate')
on conflict (room_id, amenity_id) do update
  set available = excluded.available, source_url = excluded.source_url,
      fetched_at = excluded.fetched_at, verified_at = excluded.verified_at;

update room_amenities ra
   set source_id = s.id
  from sources s
 where s.url = ra.source_url and s.data_type = 'floor' and ra.source_id is null;

commit;

-- =====================================================================
-- WHAT HIS GRID CARRIES THAT IS DELIBERATELY *NOT* SEEDED HERE
--
--   ALT GAMES — his column is prose: "rare", "mixed games", "plo",
--     "$4/8 Omaha/8". Writing cash_games rows from that risks FALSE
--     PRESENCE, which sends someone across town for a game that is not
--     spread — the failure this project treats as worse than omission.
--     Nothing added, including the Wynn PLO named in his review.
--     Needs exact stakes from him.
--
--   ATLAS OR BRAVO — the waitlist vendor per room (Wynn, Venetian and
--     Westgate on PokerAtlas; the rest on Bravo). Real, complete data
--     with NO COLUMN to land in: this is the parked waitlist_enabled /
--     provider field. Needs a migration before it can be seeded.
--
--   SKYLINE and BOULDER STATION are absent from his grid entirely.
-- =====================================================================

-- =====================================================================
-- PARTNER APPLY — 2026-08-07. GAMES, and the first game-verified rows.
-- =====================================================================
-- Stamped with the morning it was applied (noon-Vegas convention), NOT
-- bulk re-stamped: every fact touched below carries 08-07 and every fact
-- left alone keeps its 08-06 date, so freshness ages honestly.
--
-- Three of these are the "ALT GAMES" gap the previous pass refused to
-- guess at. His prose said "$4/8 Omaha/8" and the rule was that prose is
-- not a stakes row; he has now given exact stakes, so the rows that
-- ALREADY EXISTED become verified rather than being invented. That is
-- the omission-over-false-presence rule paying out: the rows were right,
-- and waiting cost nothing but a week.
--
-- A SECOND FLOOR SOURCE JOINS THE SHEET. The Wynn PLO structures come
-- from a long-form review doc, and the split is the rake-receipt
-- mechanism used exactly as designed: `source_url` cites the doc for the
-- STAKES, `rake_source_url` cites the sheet for the RAKE. One row, two
-- sources, each naming the document that actually carries the fact.
-- =====================================================================

begin;

insert into sources (data_type, url, label, cadence_hours, status, last_fetched_at, last_ok_at)
values (
  'floor',
  'https://docs.google.com/document/d/1jLMmebgG9kmzNWuT6lFu8hcgrszB052v8m-A3cfyRzQ/edit',
  'Partner floor data — Long Form Reviews (boots on the ground)',
  24, 'ok', timestamptz '2026-08-07 12:00:00-07', timestamptz '2026-08-07 12:00:00-07'
)
on conflict (url, data_type) do nothing;

-- ---------------------------------------------------------------------
-- THE THREE O8 ROWS HE CONFIRMED. Values unchanged — this is a
-- verification, not a correction, and it is recorded the same way.
-- These are the first GAME-verified rows in the product: `verified_at`
-- on cash_games has been NULL for every row until this morning.
--
-- ONLY verified_at moves. The web citation and its fetch date STAY:
-- the stakes fact came from that page, the partner confirmed it, and the
-- confirmation is the stamp — not a re-sourcing. Repointing source_url
-- at the sheet would erase where the fact came from, which is the
-- child-provenance rule ("every row cites where ITS fact came from")
-- violated in the flattering direction. This mirrors production exactly.
-- ---------------------------------------------------------------------
update cash_games c
   set verified_at = timestamptz '2026-08-07 12:00:00-07'
  from rooms r
 where r.id = c.room_id
   and (r.slug, c.stakes_label) in (
     ('orleans',          '$8/16 Omaha hi/lo'),
     ('santa-fe-station', '$4/8 Omaha hi/lo'),
     ('south-point',      '$4/8 Omaha hi/lo')
   );

-- ---------------------------------------------------------------------
-- GOLDEN NUGGET $4/8 LIMIT — a NEW game, verified on sight.
-- RAKE FIELDS STAY NULL: his GN rake cell is empty, and a room that
-- spreads a game we can see is a different claim from a room whose rake
-- we know. NULL rake_type means "no figure", which the schema's
-- rake_model_coherent check enforces and the page renders as a dash.
-- ---------------------------------------------------------------------
insert into cash_games (
  room_id, game, small_bet, big_bet, stakes_label,
  source_url, fetched_at, verified_at
)
select r.id, 'lhe'::game_kind, 4.00, 8.00, '$4/8 limit',
       'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       timestamptz '2026-08-07 12:00:00-07', timestamptz '2026-08-07 12:00:00-07'
from rooms r where r.slug = 'golden-nugget'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- WYNN PLO — two new games from the review doc, with the structures he
-- recorded. Rake is pot / cap $5 / drop $0, matching the Wynn rows
-- already verified against the sheet, and cited to the SHEET via the
-- rake receipt while the stakes cite the DOC.
-- ---------------------------------------------------------------------
insert into cash_games (
  room_id, game, small_blind, big_blind, stakes_label,
  rake_type, rake_cap, jackpot_drop, structure_note, straddle_rule,
  source_url, fetched_at, verified_at,
  rake_source_url, rake_fetched_at, rake_verified_at
)
select r.id, v.game::game_kind, v.sb, v.bb, v.label,
       'pot', 5.00, 0.00, v.structure_note, v.straddle_rule,
       'https://docs.google.com/document/d/1jLMmebgG9kmzNWuT6lFu8hcgrszB052v8m-A3cfyRzQ/edit',
       timestamptz '2026-08-07 12:00:00-07', timestamptz '2026-08-07 12:00:00-07',
       'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       timestamptz '2026-08-07 12:00:00-07', timestamptz '2026-08-07 12:00:00-07'
from rooms r
cross join (values
  ('plo', 1.00, 2.00,  '$1/2 PLO',  '$5 minimum limp', null),
  ('plo', 5.00, 10.00, '$5/10 PLO', null,              '$20 straddle')
) as v(game, sb, bb, label, structure_note, straddle_rule)
where r.slug = 'wynn-encore'
on conflict do nothing;

update cash_games c
   set source_id = s.id
  from sources s
 where s.url = c.source_url and s.data_type = 'floor' and c.source_id is null;

commit;

-- =====================================================================
-- VENDOR AND FORMATS — 2026-08-07, from the same partner sheet.
--
-- Partner data is law (the 2026-08-05 ruling), so every row here lands
-- with verified_at SET and cited to the sheet. Nothing below renders:
-- the waitlist button is hidden by standing ruling and every format row
-- has a NULL label. These are facts put where they cannot be lost.
--
-- EVERY SLUG IS CHECKED BY NAME, NOT BY COUNT. The seed's own detector
-- rule is "copy, don't retype" — but a rule is not a mechanism, and a
-- mistyped slug in a `where slug in (...)` inserts one row fewer in
-- silence. The self-check at the bottom would catch the total and blame
-- the count; these guards name the slug that was wrong. `westgate` cost
-- an hour once by being spelled with an "and" the stored URL did not
-- have, and that was in a script that DID report a finding — about a URL
-- we do not hold.
-- =====================================================================
begin;

-- Waitlist vendor, 15 of 17 rooms. Skyline and Boulder Station are
-- ABSENT rather than false: the sheet does not say they run no list, it
-- says nothing about them, and those are different facts. A row here
-- means "we know who runs it"; no row means "not answered" — the same
-- distinction room_amenities draws, and the reason the amenity filter
-- needs a third state at all.
-- THE LIST, THE GUARD AND THE INSERT ARE ONE STATEMENT — deliberately.
-- The first version put them in three, with the slug list in a
-- `create temp table ... on commit drop`, and the seed failed with
-- `relation "_fmt" does not exist`: the Supabase seeder splits the file
-- into batches and commits between them, so the temp table was dropped
-- between its creation and its use. (It runs clean under `psql`, which
-- is the trap — the tool used to check the SQL is not the tool that runs
-- it.) Inside a DO block the whole thing is a single statement and no
-- batching boundary can fall through the middle of it.
do $$
declare bad text;
begin
  create temp table _wl(slug text primary key, vendor waitlist_vendor);
  insert into _wl values
    -- PokerAtlas
    ('wynn-encore','pokeratlas'), ('venetian','pokeratlas'), ('westgate','pokeratlas'),
    -- Bravo
    ('aria','bravo'), ('bellagio','bravo'), ('caesars-palace','bravo'),
    ('golden-nugget','bravo'), ('green-valley-ranch','bravo'), ('horseshoe','bravo'),
    ('mandalay-bay','bravo'), ('mgm-grand','bravo'), ('orleans','bravo'),
    ('red-rock','bravo'), ('santa-fe-station','bravo'), ('south-point','bravo');

  select string_agg(w.slug, ', ' order by w.slug) into bad
    from _wl w where not exists (select 1 from rooms r where r.slug = w.slug);
  if bad is not null then
    raise exception 'room_waitlist names slugs that are not rooms: %', bad;
  end if;

  insert into room_waitlist (room_id, vendor, url, enabled, source_url, fetched_at, verified_at)
  select r.id, w.vendor, null, false,
         'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
         timestamptz '2026-08-07 12:00:00-07', timestamptz '2026-08-07 12:00:00-07'
    from _wl w join rooms r on r.slug = w.slug
  on conflict (room_id) do update
    set vendor = excluded.vendor, source_url = excluded.source_url,
        fetched_at = excluded.fetched_at, verified_at = excluded.verified_at;

  drop table _wl;
end $$;

-- Formats: the two dbbp observations. `label` is NULL, so nothing
-- renders — see the FORMATS block in the room page, which gates on
-- exactly that.
do $$
declare bad text;
begin
  create temp table _fmt(slug text primary key);
  insert into _fmt values ('venetian'), ('south-point');

  select string_agg(f.slug, ', ' order by f.slug) into bad
    from _fmt f where not exists (select 1 from rooms r where r.slug = f.slug);
  if bad is not null then
    raise exception 'room_formats names slugs that are not rooms: %', bad;
  end if;

  insert into room_formats (room_id, slug, label, note, source_url, fetched_at, verified_at)
  select r.id, 'dbbp', null,
         'Abbreviation as recorded on the partner sheet; expansion unconfirmed — see README open items.',
         'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
         timestamptz '2026-08-07 12:00:00-07', timestamptz '2026-08-07 12:00:00-07'
    from _fmt f join rooms r on r.slug = f.slug
  on conflict (room_id, slug) do update
    set note = excluded.note, source_url = excluded.source_url,
        fetched_at = excluded.fetched_at, verified_at = excluded.verified_at;

  drop table _fmt;
end $$;

commit;

-- =====================================================================
-- PARTNER APPLY — 2026-08-08. SOUTH POINT CORROBORATED, RED ROCK CORRECTED.
-- =====================================================================
-- Stamped with the morning it was applied (noon-Vegas convention), NOT bulk
-- re-stamped: the nine rows below carry 08-08 and every other fact keeps
-- its 08-06 or 08-07 date, so freshness ages honestly.
--
-- TWO SHAPES OF THE SAME MORNING, AND THEY ARE NOT THE SAME EDIT.
--
--   SOUTH POINT is CORROBORATION. His sheet reads 5+3, which is exactly what
--   the seeded rows already said. Nothing about the rake changes, so nothing
--   about the rake's PROVENANCE changes either: the cap and drop still came
--   off Vegas Advantage's South Point page, and that page is still where a
--   reader should go to check them. Only `rake_verified_at` moves.
--
--   RED ROCK is a CORRECTION. His sheet reads 5+3 where the web said 6+2, and
--   partner data is law (the 2026-08-05 ruling), so the values change AND the
--   receipt follows them to the sheet. A row whose figure came from the sheet
--   must cite the sheet; that is the same rule, pointing the other way.
--
-- THE RULE IS ONE RULE: A ROW CITES WHERE ITS OWN FACT CAME FROM. Repointing
-- South Point's rake receipt at the sheet would erase the page the figure was
-- actually read from and claim a re-sourcing that did not happen — the
-- child-provenance rule violated in the flattering direction, which is how it
-- always gets violated. This mirrors the O8 verify in 1edeb7d exactly.
--
-- NOTE THE DIVERGENCE FROM THE 08-06 BLOCK ABOVE, which DID repoint
-- rake_source_url onto the sheet for Wynn/Venetian/GVR on a pure
-- corroboration. 08-07 reasoned that through and landed the other way. This
-- follows 08-07. The three 08-06 rooms are not rewritten here — prod carries
-- them as they stand and the seed's job is to match prod, not to improve on
-- it — but they are the odd ones out, and they are a cleanup to raise, not a
-- precedent to copy.
--
-- RAKE_PERCENT DOES NOT MOVE ON EITHER ROOM. His shorthand is "cap + drop"
-- and says nothing about a percentage; Red Rock's 10.00 is still the web's
-- figure, uncorroborated and uncontradicted. Correcting a cap is not a
-- statement about the percent, and rewriting it here would be inventing.
-- =====================================================================

begin;

-- SOUTH POINT — all 6 rows (3 NLH, 2 LHE, 1 O8). STAMP ONLY. rake_cap,
-- jackpot_drop, source_url, rake_source_url, fetched_at and rake_fetched_at
-- are all deliberately absent from this SET clause.
update cash_games c
   set rake_verified_at = timestamptz '2026-08-08 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug = 'south-point';

-- RED ROCK — all 3 rows ($1/3 NLH, $3/5 NLH, $4/8 limit). Cap 6 -> 5,
-- drop 2 -> 3, and the receipt moves to the sheet because the figures did.
-- The URL is copied from the `sources` row inserted above, not retyped: the
-- rake receipt is matched to that row by string equality, and a typo here
-- produces a citation pointing at nothing while every count still passes.
update cash_games c
   set rake_cap = 5.00, jackpot_drop = 3.00,
       rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       rake_fetched_at  = timestamptz '2026-08-08 12:00:00-07',
       rake_verified_at = timestamptz '2026-08-08 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug = 'red-rock';

-- THE GUARD NAMES THE ROOM, NOT THE TOTAL. Both statements above are
-- `where r.slug = '...'`, and a mistyped slug updates ZERO rows in silence.
-- The self-check at the bottom would catch the shortfall and report it as a
-- rake-verified count that is nine too low, which is true and useless — it
-- names the number, not the room. This asserts the SHAPE of each room's
-- result, so a wrong slug, a half-applied correction or a South Point row
-- that quietly acquired a sheet citation each fail here saying which.
do $$
declare
  n_sp int; n_sp_receipt int; n_rr int;
begin
  -- South Point: 6 rows stamped 08-08, every one still citing its own page.
  select count(*) into n_sp
    from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'south-point'
     and c.rake_verified_at = timestamptz '2026-08-08 12:00:00-07';
  if n_sp <> 6 then
    raise exception 'south-point: expected 6 rake-verified rows at 2026-08-08, got %', n_sp;
  end if;

  select count(*) into n_sp_receipt
    from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'south-point' and c.rake_source_url is not null;
  if n_sp_receipt <> 0 then
    raise exception
      'south-point: % row(s) carry a rake_source_url — corroboration must not re-source the figure', n_sp_receipt;
  end if;

  -- Red Rock: 3 rows at cap 5 / drop 3 / percent 10, cited to the sheet.
  select count(*) into n_rr
    from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'red-rock'
     and c.rake_cap = 5.00 and c.jackpot_drop = 3.00 and c.rake_percent = 10.00
     and c.rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit'
     and c.rake_fetched_at  = timestamptz '2026-08-08 12:00:00-07'
     and c.rake_verified_at = timestamptz '2026-08-08 12:00:00-07';
  if n_rr <> 3 then
    raise exception 'red-rock: expected 3 rows at cap 5 / drop 3 / percent 10 cited to the sheet, got %', n_rr;
  end if;
end $$;

commit;

-- =====================================================================
-- CONVENTION CLEANUP — 2026-08-08. THE 08-06 RECEIPTS GO BACK ON THE PAGE.
-- =====================================================================
-- NO FACT CHANGES HERE AND NO COUNT MOVES. This closes the divergence the
-- 08-08 block above names: the 08-06 apply repointed `rake_source_url` at the
-- SinCityGrinders sheet for Wynn, Venetian and GVR on what were PURE
-- CORROBORATIONS, and 08-07 then reasoned the opposite way and 08-08 followed
-- it. Two conventions were live in one file. This is the older one being
-- brought to the newer, which is the direction that matches the rule.
--
-- THE RULE, ONCE MORE: A ROW CITES WHERE ITS OWN FACT CAME FROM. The partner
-- agreeing with a figure is a VERIFICATION of it, not a RE-SOURCING of it.
-- Wynn's $5 cap was read off Vegas Advantage and is still read off Vegas
-- Advantage; the sheet is why we believe it, not where it came from. Pointing
-- the receipt at the sheet erases the page a reader would check and claims a
-- provenance that never happened — the child-provenance rule violated in the
-- flattering direction.
--
-- WHAT "RESTORE" MEANS HERE IS **NULL**, and that is not data loss. Before the
-- 08-06 apply these rows had no rake receipt at all: `rake_source_url` was set
-- for ORLEANS ONLY, the one genuine split in the seed. NULL is the schema's
-- documented "the rake came from this row's own `source_url`" — read it as
-- coalesce(rake_source_url, source_url) — so nulling the column hands the
-- citation back to the Vegas Advantage page each figure was actually read
-- from. There is no URL to copy here because the original value was the
-- absence of one.
--
-- THE STAMPS DO NOT MOVE. `rake_verified_at` stays 2026-08-06 on all fourteen
-- rows: the partner did stand in those rooms that morning and that fact is
-- untouched by where the figure is cited. `rake_fetched_at` DOES clear,
-- because it dated the sheet read, and there is no longer a sheet read on
-- these rows — the row's own `fetched_at` dates the page.
--
-- FOURTEEN ROWS, NOT SIXTEEN — AND THE PREDICATE, NOT A LIST, IS WHAT EXCLUDES
-- THE OTHER TWO. Wynn's two PLO rows also cite the sheet for rake, and they
-- must KEEP it: they were inserted on 08-07 from the long-form review doc with
-- SPLIT PROVENANCE BY DESIGN — `source_url` cites the doc for the STAKES,
-- `rake_source_url` cites the sheet for the RAKE, because the doc carries no
-- rake figure. Nulling those two would resolve their rake to a document that
-- does not contain it, which is the exact fabrication this cleanup is against.
-- So the WHERE clause tests `source_url not like '%docs.google.com%'` — "only
-- drop a rake receipt when the row's own source_url is the page the figure was
-- read from". The PLO rows fall out of that by construction. A hardcoded
-- exception list would have worked today and rotted the next time a row
-- arrived with partner-sourced stakes.
-- =====================================================================

begin;

update cash_games c
   set rake_source_url = null,
       rake_fetched_at = null
  from rooms r
 where r.id = c.room_id
   and r.slug in ('wynn-encore','venetian','green-valley-ranch')
   and c.rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit'
   and c.source_url not like '%docs.google.com%';

-- THE GUARD NAMES THE ROOM, AND ALSO NAMES WHAT MUST NOT HAVE MOVED. A
-- cleanup that silently took a rake value, a verification stamp or the two
-- Wynn PLO receipts with it would leave every count identical — the
-- self-check below cannot see any of it, because no count changes here.
do $$
declare
  n_gvr int; n_ven int; n_wynn int; n_plo int; n_rv int; n_bad int;
begin
  -- Receipts handed back: 5 GVR, 6 Venetian, 3 Wynn NLH, all still stamped
  -- 08-06 and all still carrying the rake values the web gave them.
  select count(*) into n_gvr from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'green-valley-ranch'
     and c.rake_source_url is null and c.rake_fetched_at is null
     and c.rake_verified_at = timestamptz '2026-08-06 12:00:00-07'
     and c.rake_percent = 10.00 and c.rake_cap = 5.00 and c.jackpot_drop = 3.00;
  if n_gvr <> 5 then
    raise exception 'green-valley-ranch: expected 5 rows restored to their own page at cap 5 / drop 3 / 08-06, got %', n_gvr;
  end if;

  select count(*) into n_ven from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'venetian'
     and c.rake_source_url is null and c.rake_fetched_at is null
     and c.rake_verified_at = timestamptz '2026-08-06 12:00:00-07'
     and c.rake_percent is null and c.rake_cap = 5.00 and c.jackpot_drop = 2.00;
  if n_ven <> 6 then
    raise exception 'venetian: expected 6 rows restored to their own page at cap 5 / drop 2 / 08-06, got %', n_ven;
  end if;

  select count(*) into n_wynn from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'wynn-encore'
     and c.rake_source_url is null and c.rake_fetched_at is null
     and c.rake_verified_at = timestamptz '2026-08-06 12:00:00-07'
     and c.rake_percent = 10.00 and c.rake_cap = 5.00 and c.jackpot_drop = 0.00;
  if n_wynn <> 3 then
    raise exception 'wynn-encore: expected 3 NLH rows restored to their own page at cap 5 / drop 0 / 08-06, got %', n_wynn;
  end if;

  -- THE TWO THAT MUST NOT HAVE MOVED. Split provenance by design: stakes from
  -- the review doc, rake from the sheet. If this ever reads 0, the predicate
  -- above stopped excluding them and two rows now cite a doc with no rake in it.
  select count(*) into n_plo from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'wynn-encore'
     and c.source_url like '%docs.google.com/document%'
     and c.rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit'
     and c.rake_fetched_at  = timestamptz '2026-08-07 12:00:00-07'
     and c.rake_verified_at = timestamptz '2026-08-07 12:00:00-07';
  if n_plo <> 2 then
    raise exception
      'wynn-encore PLO: expected 2 rows still citing the sheet for rake (stakes from the review doc), got % — the restore over-reached', n_plo;
  end if;

  -- NO VERIFICATION WAS LOST. This is the assertion the self-check cannot
  -- make, because 42 is what it reads whether or not this block ran correctly.
  select count(*) into n_rv from cash_games where rake_verified_at is not null;
  if n_rv <> 42 then
    raise exception 'rake-verified count moved to % — this cleanup must not change it', n_rv;
  end if;

  -- NO ROW IN THE THREE CLEANED ROOMS MAY STILL CITE THE SHEET FOR A FIGURE ITS
  -- OWN PAGE CARRIES. Scoped to those three ON PURPOSE, and the first draft of
  -- this check was not — it asked the question globally and caught seventeen
  -- rows at Orleans and Santa Fe, which are RIGHT to cite the sheet: 08-06
  -- CORRECTED them (Santa Fe's cap 6 -> 5, Orleans' drop unknown -> 3), so the
  -- sheet is where those figures came from. "Sheet-cited, web source_url,
  -- stamped 08-06" is the shape of a corroboration AND of a correction, and
  -- nothing in the row tells them apart — only the pre-apply value does, which
  -- is history this file no longer holds. So the invariant is named per room by
  -- the three rooms we know were corroborations, never inferred from shape.
  select count(*) into n_bad from cash_games c join rooms r on r.id = c.room_id
   where r.slug in ('wynn-encore','venetian','green-valley-ranch')
     and c.rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit'
     and c.source_url not like '%docs.google.com%';
  if n_bad <> 0 then
    raise exception
      '% row(s) in the three cleaned rooms still cite the sheet for a figure their own page carries', n_bad;
  end if;
end $$;

commit;

-- =====================================================================
-- PARTNER APPLY — 2026-08-09. SYNCED FROM PRODUCTION'S OWN change_log.
-- =====================================================================
-- 57 rows, written by approve_change at apply time. This block reproduces
-- them; it is NOT derived from the differ's parse of the sheet. That
-- independence is the entire point: the seed and the parse can then be
-- compared, and agreement means something. A seed generated by the parse
-- would agree with the parse by construction and prove nothing.
--
-- EVERY WRITE IS GUARDED ON THE OLD VALUE. If the seed does not already hold
-- what the log says was replaced, the row is one this block would otherwise
-- corrupt — so it raises instead of forcing. That check is why this is a sync
-- rather than an overwrite.
--
-- WHAT IS NOT HERE: the three room_amenities INSERTS. The log identifies their
-- amenity by UUID, and `amenity_types` ids are GENERATED by this file rather
-- than pinned — so a production UUID resolves to nothing locally, by
-- construction. The detail text is suggestive ("Call in to get on the list"
-- reads like phonein) and suggestive is exactly the reasoning this project
-- bans: "Parking comped by the poker room" is `validated`, not the `freeself`
-- the sheet's Parking column would imply, and those are different facts about
-- a room. Reported instead; they land when the slugs are known.
--
-- Also excluded: the two small_blind 1.00 -> 1.00 no-ops. A write that changes
-- nothing is not a fact and is not pinned as one.
-- =====================================================================
begin;

-- --- cash_games: rake figures, corrections and gains, cited to the sheet ---
-- NO STAMP ON THESE. The log records rake_verified_at moving for sixteen
-- STAMP-ONLY rows and for none of the fourteen corrected or gained ones, and
-- that is right: approve_change writes a stamp only when the proposal carries
-- one. The first draft of this block stamped them too and the self-check caught
-- it at 67 rake-verified against an expected 42 — which is exactly the job that
-- assertion exists to do.
do $$
declare n int;
begin
  -- BELLAGIO: 4 NLH rows, 5.00 -> 6.00. The limit and PLO rows are NOT touched;
  -- an unqualified room rake is the no-limit rake.
  select count(*) into n from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'bellagio' and c.game = 'nlh' and c.rake_cap = 5.00;
  if n <> 4 then raise exception 'bellagio: expected 4 NLH rows at cap 5.00, found %', n; end if;

  select count(*) into n from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'mandalay-bay' and c.game = 'nlh' and c.rake_cap = 5.00 and c.jackpot_drop = 1.00;
  if n <> 3 then raise exception 'mandalay-bay: expected 3 NLH rows at 5.00/1.00, found %', n; end if;

  select count(*) into n from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'horseshoe' and c.game = 'nlh'
     and c.rake_cap is null and c.jackpot_drop is null and c.rake_type is null;
  if n <> 2 then raise exception 'horseshoe: expected 2 model-less NLH rows, found %', n; end if;
end $$;

update cash_games c set rake_cap = 6.00,
       rake_source_url  = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       rake_fetched_at  = timestamptz '2026-08-09 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug = 'bellagio' and c.game = 'nlh' and c.rake_cap = 5.00;

update cash_games c set rake_cap = 6.00, jackpot_drop = 2.00,
       rake_source_url  = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       rake_fetched_at  = timestamptz '2026-08-09 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug = 'mandalay-bay' and c.game = 'nlh'
   and c.rake_cap = 5.00 and c.jackpot_drop = 1.00;

-- HORSESHOE GAINS A RAKE. rake_type precedes its figures — one statement here,
-- because rake_model_coherent makes the intermediate state unrepresentable and
-- SQL applies a single UPDATE's columns together.
update cash_games c set rake_type = 'pot'::rake_kind, rake_cap = 6.00, jackpot_drop = 2.00,
       rake_source_url  = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       rake_fetched_at  = timestamptz '2026-08-09 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug = 'horseshoe' and c.game = 'nlh' and c.rake_type is null;

-- --- cash_games: STAMP-ONLY. No citation moves: a floor visit that confirms a
-- --- figure we already hold is a corroboration, not a re-sourcing. This is the
-- --- 4a55228 rule, and approve_change applied it the same way.
-- --- golden-nugget is ×2 of its 3 rows: the third ($4/8 limit) carries no rake
-- --- figures at all, and a stamp on a row with nothing to confirm would be a
-- --- claim about nothing.
update cash_games c set rake_verified_at = timestamptz '2026-08-08 19:00:00+00'
  from rooms r
 where r.id = c.room_id
   and c.rake_verified_at is null
   and (r.slug in ('aria', 'westgate', 'mgm-grand', 'caesars-palace')
        or (r.slug = 'golden-nugget' and c.rake_cap is not null));

-- --- cash_games: stakes corrections. $1/2 was never spread at either room.
update cash_games c set stakes_label = '$1/3', big_blind = 3.00,
       source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       fetched_at = timestamptz '2026-08-09 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug in ('golden-nugget', 'south-point')
   and c.stakes_label = '$1/2' and c.big_blind = 2.00;

-- --- cash_games: structure note, Wynn's $5/10 PLO
-- AND THE STAMP CLEARS. approve_change's rule: a value a person has not seen is
-- not person-verified, so a non-stamp write drops verified_at on the row it
-- changes. Prod shows this row unverified afterwards, and the first version of
-- this block reproduced the write without its side-effect — the self-check then
-- read 6 game-verified against prod's 5, which is exactly the drift the tuple
-- exists to catch. Prod is the record; the seed follows it.
--
-- WORTH NOTING FOR THE TIMELINE: under migration 008 a FLOOR-sourced write
-- preserves the stamp, and this apply cleared it — so this row was written
-- before 008 reached prod, under 007's unconditional rule. The seed reproduces
-- what happened, not what would happen if it were re-run today.
update cash_games c set structure_note = '$20 straddle',
       verified_at = null,
       source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       fetched_at = timestamptz '2026-08-09 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug = 'wynn-encore' and c.stakes_label = '$5/10 PLO'
   and c.structure_note is null;

-- --- rooms: phone. Ten gains and four corrections — the corrected four
-- --- replace resort switchboards with the poker room's own line.
do $$
declare n int;
begin
  select count(*) into n from rooms where slug in
    ('aria','bellagio','caesars-palace','golden-nugget','green-valley-ranch','horseshoe',
     'mandalay-bay','mgm-grand','santa-fe-station','venetian') and phone is null;
  if n <> 10 then raise exception 'expected 10 rooms with no phone, found %', n; end if;
end $$;

update rooms set phone = v.phone,
       source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       fetched_at = timestamptz '2026-08-09 12:00:00-07'
  from (values
    ('aria','702-590-7230'), ('bellagio','702-693-7290'), ('caesars-palace','702-785-6566'),
    ('golden-nugget','702-386-8383'), ('green-valley-ranch','702-617-6928'),
    ('horseshoe','702-967-4403'), ('mandalay-bay','702-632-7790'), ('mgm-grand','702-891-7464'),
    ('santa-fe-station','702-515-4315'), ('venetian','702-414-7657'),
    ('orleans','702-365-7150'), ('red-rock','702-797-7766'),
    ('south-point','702-797-8073'), ('wynn-encore','702-770-7654')
  ) as v(slug, phone)
 where rooms.slug = v.slug;

-- --- room_amenities: South Point's tableside service. The sheet reads
-- --- "no but close", which the differ refuses to coerce; the floor visit
-- --- resolved it to a confirmed absence, which is a displayed fact.
do $$
declare n int;
begin
  select count(*) into n from room_amenities ra
    join rooms r on r.id = ra.room_id join amenity_types at on at.id = ra.amenity_id
   where r.slug = 'south-point' and at.slug = 'tableside' and ra.available = true;
  if n <> 1 then raise exception 'south-point tableside: expected 1 available row, found %', n; end if;
end $$;

update room_amenities ra set available = false,
       source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       fetched_at = timestamptz '2026-08-09 12:00:00-07',
       verified_at = timestamptz '2026-08-09 12:00:00-07'
  from rooms r, amenity_types at
 where r.id = ra.room_id and at.id = ra.amenity_id
   and r.slug = 'south-point' and at.slug = 'tableside';

-- --- room_amenities: three claims the long-form reviews state outright.
-- --- Cited to the reviews DOC, not the sheet — a receipt points at the
-- --- document the fact came from.
--
-- ADDED BY SLUG, WHICH IS THE ONLY PORTABLE KEY. The change_log identifies
-- these by amenity UUID, and `amenity_types` ids are generated by this file
-- rather than pinned — so a production UUID resolves to nothing here. They were
-- held back for a round rather than guessed, and the caution paid: the parking
-- claim is `validated` ("comped by the poker room"), NOT the `freeself` the
-- sheet's Parking column would have suggested. Those are different facts, and
-- the detail text alone would have talked me into the wrong one.
--
-- NOT VERIFIED. A review is a document, not a floor visit: available = true,
-- fetched_at set, verified_at left NULL. Prod holds them exactly this way.
insert into room_amenities (room_id, amenity_id, available, detail, source_url, fetched_at)
select r.id, at.id, true, v.detail,
       'https://docs.google.com/document/d/1jLMmebgG9kmzNWuT6lFu8hcgrszB052v8m-A3cfyRzQ/edit',
       timestamptz '2026-08-09 12:00:00-07'
  from (values
    ('golden-nugget', 'phonein',    'Call in to get on the list ahead of time'),
    ('golden-nugget', 'validated',  'Parking comped by the poker room'),
    ('venetian',      'nonsmoking', 'Smoke-free room; no smoking anywhere on the second floor')
  ) as v(slug, amenity, detail)
  join rooms r on r.slug = v.slug
  join amenity_types at on at.slug = v.amenity
 where not exists (
   select 1 from room_amenities x where x.room_id = r.id and x.amenity_id = at.id);

do $$
declare n int;
begin
  select count(*) into n from room_amenities ra
    join rooms r on r.id = ra.room_id join amenity_types at on at.id = ra.amenity_id
   where (r.slug = 'golden-nugget' and at.slug in ('phonein', 'validated'))
      or (r.slug = 'venetian' and at.slug = 'nonsmoking');
  if n <> 3 then raise exception 'expected the 3 review-sourced amenities, found %', n; end if;
end $$;

-- --- THE FIRST AUTOMATED APPLY, 2026-08-10. Two rows, by the differ.
-- --- Caesars Palace states 6+0, so the drop is a $0 FIGURE the sheet gives —
-- --- not an absent one. The rake receipt moves; the stakes citation does not.
--
-- ⚠️ THE STAKES CITATION IS RESTORED HERE ON PURPOSE. approve_change routed the
-- receipt with `field like 'rake%'`, which jackpot_drop does not match, so the
-- run overwrote these rows' Vegas Advantage stakes citation with the partner
-- sheet — a document that does not state stakes. Repaired on prod the minute it
-- was found, and fixed at the cause in migration 010. The seed records the
-- REPAIRED state, because that is what production holds.
update cash_games c set jackpot_drop = 0.00,
       rake_source_url = 'https://docs.google.com/spreadsheets/d/1Z_SEZI1Wu737tyfSJlakUlheU32P9eHiu7hRD5loDLM/edit',
       rake_fetched_at = timestamptz '2026-08-09 12:00:00-07'
  from rooms r
 where r.id = c.room_id and r.slug = 'caesars-palace'
   and c.stakes_label in ('$1/3', '$2/5') and c.jackpot_drop is null;

do $$
declare n int;
begin
  select count(*) into n from cash_games c join rooms r on r.id = c.room_id
   where r.slug = 'caesars-palace' and c.jackpot_drop = 0.00
     and c.source_url like '%vegasadvantage%'
     and c.rake_source_url like '%docs.google.com%';
  if n <> 2 then
    raise exception 'caesars-palace: expected 2 rows with a $0 drop, stakes cited to the page and rake to the sheet, got %', n;
  end if;
end $$;

-- --- CITATIONS, RECORDED AS PRODUCTION HOLDS THEM ---
-- The seed's job is to match prod, so it records these even where they are
-- wrong — with the reason, so nobody reads them as intended.
--
-- 1. LEGITIMATE. The stakes corrections and the Wynn structure note came from
--    the partner documents, so those rows cite them.
update cash_games c set source_url = 'https://docs.google.com/document/d/1jLMmebgG9kmzNWuT6lFu8hcgrszB052v8m-A3cfyRzQ/edit'
  from rooms r
 where r.id = c.room_id
   and ((r.slug = 'golden-nugget' and c.stakes_label = '$1/3')
     or (r.slug = 'south-point'   and c.stakes_label = '$1/3')
     or (r.slug = 'wynn-encore'   and c.stakes_label in ('$1/2 PLO', '$5/10 PLO')));

-- 2. REPAIRED. These five rows had a jackpot_drop change applied on
--    2026-08-09, and approve_change routed the receipt with `field like
--    'rake%'` — which jackpot_drop does not match — so each write overwrote the
--    row's STAKES citation with the partner sheet, a document that does not
--    state stakes. Fixed at the cause in migration 010; the rows themselves were
--    repaired on prod on 2026-08-10.
--
--    THE RESULT IS THE SPLIT-PROVENANCE SHAPE, which is the correct one and is
--    worth reading as a positive statement rather than as damage undone: the
--    STAKES cite the Vegas Advantage page that states them, at the research
--    pass's own timestamp, and the RAKE cites the partner sheet that corrected
--    it. One row, two facts, two receipts — the same split that lets Orleans
--    cite Boyd for its stakes and Vegas Advantage for its cap.
update cash_games c
   set source_url = 'https://vegasadvantage.com/open-las-vegas-poker-rooms/' || r.slug || '/',
       fetched_at = timestamptz '2026-08-03 12:00:00-07'
  from rooms r
 where r.id = c.room_id
   and ((r.slug = 'horseshoe'    and c.stakes_label in ('$1/3', '$2/3'))
     or (r.slug = 'mandalay-bay' and c.stakes_label in ('$1/2', '$2/3', '$5/10')));

do $$
declare n int;
begin
  select count(*) into n from cash_games c join rooms r on r.id = c.room_id
   where c.source_url like '%docs.google.com%';
  if n <> 5 then
    raise exception 'expected 5 rows citing a partner document for stakes — the corrections, and only those — got %', n;
  end if;
end $$;

commit;

-- =====================================================================
-- THE SEED CHECKS ITSELF.
--
-- The seed and production have diverged twice: once silently, once
-- reopened by a morning apply that landed straight on prod. A seed that
-- "looks applied" and a seed that MATCHES are different states, and the
-- difference is invisible until something reads a count. So the file
-- asserts what it should have produced, and a reseed that drifts from
-- production fails HERE rather than in a page nobody is looking at.
-- =====================================================================
do $$
declare
  n_rooms int; n_games int; n_gv int; n_rv int; n_src int; n_wl int; n_fmt int;
begin
  select count(*) into n_rooms from rooms;
  select count(*) into n_games from cash_games;
  select count(*) into n_gv    from cash_games where verified_at is not null;
  select count(*) into n_rv    from cash_games where rake_verified_at is not null;
  select count(*) into n_src   from sources;
  select count(*) into n_wl    from room_waitlist;
  select count(*) into n_fmt   from room_formats;

  if (n_rooms, n_games, n_gv, n_rv, n_src, n_wl, n_fmt)
     is distinct from (17, 78, 5, 58, 44, 15, 2) then
    raise exception
      'seed does not match production: % rooms / % games / % game-verified / % rake-verified / % sources / % waitlist / % formats (expected 17 / 78 / 5 / 58 / 44 / 15 / 2)',
      n_rooms, n_games, n_gv, n_rv, n_src, n_wl, n_fmt;
  end if;
  raise notice 'seed matches production: 17 rooms / 78 games / 5 game-verified / 58 rake-verified / 44 sources / 15 waitlist / 2 formats';
end $$;
