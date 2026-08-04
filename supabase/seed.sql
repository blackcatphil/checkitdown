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
-- list (2026-03-04). Paris/WSOP is the 18th and is deliberately absent —
-- it is is_seasonal and off the roster by default.
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
