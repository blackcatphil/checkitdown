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
  n_rooms int; n_games int; n_gv int; n_rv int; n_src int;
begin
  select count(*) into n_rooms from rooms;
  select count(*) into n_games from cash_games;
  select count(*) into n_gv    from cash_games where verified_at is not null;
  select count(*) into n_rv    from cash_games where rake_verified_at is not null;
  select count(*) into n_src   from sources;

  if (n_rooms, n_games, n_gv, n_rv, n_src) is distinct from (17, 78, 6, 33, 44) then
    raise exception
      'seed does not match production: % rooms / % games / % game-verified / % rake-verified / % sources (expected 17 / 78 / 6 / 33 / 44)',
      n_rooms, n_games, n_gv, n_rv, n_src;
  end if;
  raise notice 'seed matches production: 17 rooms / 78 games / 6 game-verified / 33 rake-verified / 44 sources';
end $$;
