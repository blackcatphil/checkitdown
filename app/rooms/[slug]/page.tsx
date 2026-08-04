import { notFound } from 'next/navigation'

import { supabase } from '@/lib/supabase'

import { CorrectionForm } from './CorrectionForm'

export const revalidate = 300

const EMDASH = '—'
const AREA_LABEL: Record<string, string> = {
  strip: 'Strip',
  downtown: 'Downtown',
  off_strip: 'Off-Strip',
  locals: 'Locals',
}

export async function generateStaticParams() {
  const { data } = await supabase.from('rooms').select('slug')
  return (data ?? []).map((r) => ({ slug: r.slug }))
}

/** Section shell — every block on this page can be empty, so the empty state is
 *  the shared case rather than something each block reinvents. */
function Block({
  label,
  children,
  empty,
}: {
  label: string
  children?: React.ReactNode
  empty?: React.ReactNode
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
      <span className="cid-label">{label}</span>
      {empty ?? children}
    </section>
  )
}

/**
 * The empty state. Not damage control — this is the clearest statement of what
 * makes the product different: other guides show undated facts and let you
 * assume they are current; we show a DATED GAP. The correction link turns the
 * gap into an input, and it doubles as a visible pipeline to-do.
 */
function NotChecked({ what }: { what: string }) {
  return (
    <div
      style={{
        border: '1px dotted var(--cid-unverified-rule)',
        borderRadius: 'var(--cid-r-md)',
        padding: 'var(--cid-space-6)',
        background: 'var(--cid-fill-1)',
      }}
    >
      <p style={{ font: 'var(--cid-body-strong)', color: 'var(--cid-text-2)', margin: 0 }}>
        Not yet checked on site.
      </p>
      <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 'var(--cid-space-2) 0 0' }}>
        We have no source for {what} at this room. That is a gap in our checking, not a
        statement that the room lacks it — {what} is the kind of thing a person in the room
        can confirm in seconds and no casino publishes reliably.
      </p>
    </div>
  )
}

export default async function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const { data } = await supabase
    .from('rooms')
    .select(
      'id,slug,name,property,area,status,table_count,phone,website_url,hours_note,is_24h,'
      + 'loyalty_program,comp_rate_hourly,comp_notes,dress_code,drinks_note,'
      + 'source_url,fetched_at,verified_at,'
      + 'cash_games(stakes_label,game,min_buy_in,max_buy_in,is_uncapped,rake_type,rake_percent,'
      + 'rake_cap,jackpot_drop,structure_note,big_blind,big_bet),'
      + 'room_amenities(detail,menu_url,source_url,amenity_types(slug,label,grp)),'
      + 'house_rules(label,value)',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (!data) notFound()
  const room = data as unknown as {
    id: string; slug: string; name: string; property: string | null; area: string
    table_count: number | null; phone: string | null; website_url: string | null
    hours_note: string | null; loyalty_program: string | null; comp_rate_hourly: number | null
    comp_notes: string | null; dress_code: string | null; drinks_note: string | null
    source_url: string | null; fetched_at: string | null; verified_at: string | null
    cash_games: Array<{
      stakes_label: string; game: string; min_buy_in: number | null; max_buy_in: number | null
      is_uncapped: boolean; rake_type: string | null; rake_percent: number | null
      rake_cap: number | null; jackpot_drop: number | null; structure_note: string | null
      big_blind: number | null; big_bet: number | null
    }>
    room_amenities: Array<{
      detail: string | null; menu_url: string | null; source_url: string | null
      amenity_types: { slug: string; label: string; grp: string } | null
    }>
    house_rules: Array<{ label: string; value: string }>
  }

  const games = [...room.cash_games].sort(
    (a, b) => (Number(a.big_blind ?? a.big_bet ?? 0)) - (Number(b.big_blind ?? b.big_bet ?? 0)),
  )

  const facts: Array<[string, string | null]> = [
    ['TABLES', room.table_count != null ? String(room.table_count) : null],
    ['HOURS', room.hours_note],
    ['COMPS', room.comp_rate_hourly != null ? `$${Number(room.comp_rate_hourly).toFixed(2)}/hr` : null],
    ['CLUB', room.loyalty_program],
    ['DRESS CODE', room.dress_code],
    ['DRINKS', room.drinks_note],
  ]

  function rake(g: (typeof games)[number]) {
    if (g.rake_type == null) return null
    if (g.rake_percent != null && g.rake_cap != null) return `${Number(g.rake_percent)}% to $${Number(g.rake_cap)}`
    if (g.rake_cap != null) return `to $${Number(g.rake_cap)}`
    return null
  }

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-8)' }}>
      <header>
        <span className="cid-label">{AREA_LABEL[room.area] ?? room.area}</span>
        <h1 style={{ font: 'var(--cid-h1)', margin: 'var(--cid-space-3) 0 var(--cid-space-2)' }}>
          {room.name}
        </h1>
        {room.property && room.property !== room.name && (
          <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-3)', margin: 0 }}>{room.property}</p>
        )}
        <p
          className="num cid-unverified"
          style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)', marginTop: 'var(--cid-space-5)', display: 'inline-block' }}
        >
          UNVERIFIED · SOURCED {room.fetched_at ? new Date(room.fetched_at).toISOString().slice(0, 10) : EMDASH}
        </p>
      </header>

      <Block label="THE FACTS">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '1px', background: 'var(--cid-line-1)', border: '1px solid var(--cid-line-1)' }}>
          {facts.map(([label, value]) => (
            <div key={label} style={{ background: 'var(--cid-ink-700)', padding: 'var(--cid-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-2)' }}>
              <span className="cid-label">{label}</span>
              {value == null ? (
                <span className="num" style={{ font: 'var(--cid-num)', color: 'var(--cid-disabled)' }} title="Not yet checked on site">
                  {EMDASH}
                </span>
              ) : (
                <span className="num cid-unverified" style={{ font: 'var(--cid-num)', alignSelf: 'flex-start' }}>~{value}</span>
              )}
            </div>
          ))}
        </div>
      </Block>

      <Block
        label={`CASH GAMES · ${games.length}`}
        empty={games.length === 0 ? <NotChecked what="the games spread" /> : undefined}
      >
        <div style={{ border: '1px solid var(--cid-line-1)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) repeat(4, minmax(0,1fr))', gap: 'var(--cid-space-4)', padding: 'var(--cid-space-4) var(--cid-space-5)', background: 'var(--cid-fill-1)', borderBottom: '1px solid var(--cid-line-2)' }}>
            {['GAME', 'MIN BUY-IN', 'MAX BUY-IN', 'RAKE', 'DROP'].map((h) => (
              <span key={h} className="cid-label">{h}</span>
            ))}
          </div>
          {games.map((g, i) => (
            <div key={`${g.stakes_label}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) repeat(4, minmax(0,1fr))', gap: 'var(--cid-space-4)', padding: 'var(--cid-space-4) var(--cid-space-5)', borderBottom: '1px solid var(--cid-line-1)', alignItems: 'center' }}>
              <span className="num" style={{ font: 'var(--cid-num)', color: 'var(--cid-text)' }}>
                {g.stakes_label} <span style={{ color: 'var(--cid-dim)' }}>{g.game.toUpperCase()}</span>
              </span>
              {[
                g.min_buy_in != null ? `$${Number(g.min_buy_in)}` : null,
                g.is_uncapped ? 'Uncapped' : g.max_buy_in != null ? `$${Number(g.max_buy_in)}` : null,
                rake(g),
                g.jackpot_drop != null ? `$${Number(g.jackpot_drop)}` : null,
              ].map((v, j) =>
                v == null ? (
                  <span key={j} className="num" style={{ font: 'var(--cid-num)', color: 'var(--cid-disabled)' }} title="Not yet checked on site">{EMDASH}</span>
                ) : (
                  <span key={j} className="num cid-unverified" style={{ font: 'var(--cid-num)', justifySelf: 'start' }}>~{v}</span>
                ),
              )}
            </div>
          ))}
        </div>
      </Block>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 'var(--cid-space-7)' }}>
        <Block
          label="AMENITIES"
          empty={room.room_amenities.length === 0 ? <NotChecked what="amenities" /> : undefined}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--cid-line-1)', border: '1px solid var(--cid-line-1)' }}>
            {room.room_amenities.map((a) => (
              <div key={a.amenity_types?.slug} style={{ background: 'var(--cid-ink-700)', padding: 'var(--cid-space-4) var(--cid-space-5)', display: 'grid', gridTemplateColumns: '120px minmax(0,1fr)', gap: 'var(--cid-space-5)', alignItems: 'baseline' }}>
                <span className="cid-label">{a.amenity_types?.label}</span>
                <span className="cid-unverified" style={{ font: 'var(--cid-body)' }}>
                  {a.detail ?? 'Yes'}
                </span>
              </div>
            ))}
          </div>
        </Block>

        <Block
          label="HOUSE RULES"
          empty={room.house_rules.length === 0 ? <NotChecked what="house rules" /> : undefined}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--cid-line-1)', border: '1px solid var(--cid-line-1)' }}>
            {room.house_rules.map((r) => (
              <div key={r.label} style={{ background: 'var(--cid-ink-700)', padding: 'var(--cid-space-4) var(--cid-space-5)', display: 'grid', gridTemplateColumns: '120px minmax(0,1fr)', gap: 'var(--cid-space-5)' }}>
                <span className="cid-label">{r.label}</span>
                <span style={{ font: 'var(--cid-body)' }}>{r.value}</span>
              </div>
            ))}
          </div>
        </Block>
      </div>

      <section style={{ borderTop: '1px solid var(--cid-line-1)', paddingTop: 'var(--cid-space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-5)' }}>
        <span className="cid-label">WHERE THIS CAME FROM</span>
        <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
          Every figure on this page is sourced and none is verified — we read it from a
          published page, we have not stood in the room. Ranked columns elsewhere exclude
          this room until someone does.
          {room.source_url && (
            <>
              {' '}
              Source: <a href={room.source_url} rel="nofollow noopener" target="_blank">{new URL(room.source_url).hostname}</a>.
            </>
          )}
        </p>
        <CorrectionForm roomId={room.id} roomName={room.name} />
      </section>
    </main>
  )
}
