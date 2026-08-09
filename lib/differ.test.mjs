import assert from 'node:assert/strict'
import test from 'node:test'
import { batch, diff, parseCsv, sameValue, toFacts } from './differ.ts'

const SLUGS = new Set(['aria', 'bellagio', 'horseshoe'])

test('a quoted comma stays one field', () => {
  /* `10%, capped at $6` is ONE cell. split(',') turns it into two, shifts every
     column after it, and throws nothing — the exact shape of a silent parse
     bug writing the wrong column into the wrong field. */
  const rows = parseCsv('room,field,value\naria,hours_note,"10%, capped at $6"\n')
  assert.equal(rows[1].length, 3)
  assert.equal(rows[1][2], '10%, capped at $6')
})

test('doubled quotes, CRLF, and a missing trailing newline all survive', () => {
  const rows = parseCsv('room,field,value\r\naria,hours_note,"he said ""open"""')
  assert.equal(rows.length, 2)
  assert.equal(rows[1][2], 'he said "open"')
})

test('a header missing a required column is reported, not guessed', () => {
  const r = toFacts(parseCsv('room,value\naria,6\n'), SLUGS)
  assert.equal(r.facts.length, 0)
  assert.match(r.unparsed[0].why, /missing: field/)
})

test('an unknown room is unparsed rather than skipped silently', () => {
  const r = toFacts(parseCsv('room,field,value\nnot-a-room,table_count,12\n'), SLUGS)
  assert.equal(r.facts.length, 0)
  assert.match(r.unparsed[0].why, /unknown room/)
})

test('a field the differ may not write is refused by allowlist', () => {
  /* A new column in a partner sheet must surface as a line Phil can read, not
     be written blind because it happened to match a database column. */
  const r = toFacts(parseCsv('room,field,value\naria,verified_at,2026-08-09\n'), SLUGS)
  assert.equal(r.facts.length, 0)
  assert.match(r.unparsed[0].why, /not writable/)
})

test('a cash_games fact with no stakes column cannot be aimed at a row', () => {
  const r = toFacts(parseCsv('room,field,value\naria,rake_cap,6\n'), SLUGS)
  assert.equal(r.facts.length, 0)
  assert.match(r.unparsed[0].why, /needs a stakes column/)
})

test('currency marks are read; prose is not', () => {
  const r = toFacts(parseCsv('room,field,value,stakes\naria,rake_cap,"$6",$1/2\naria,rake_cap,about six,$2/5\n'), SLUGS)
  assert.equal(r.facts.length, 1)
  assert.equal(r.facts[0].value, 6)
  assert.match(r.unparsed[0].why, /is not a number/)
})

test('an empty value means CLEAR, and says so rather than skipping', () => {
  const r = toFacts(parseCsv('room,field,value,stakes\naria,rake_cap,,$1/2\n'), SLUGS)
  assert.equal(r.facts.length, 1)
  assert.equal(r.facts[0].value, null)
})

test('6 and 6.00 are the same figure — a differ must not propose a nightly no-op', () => {
  assert.equal(sameValue('6.00', 6), true)
  assert.equal(sameValue('$1,500', 1500), true)
  assert.equal(sameValue('open 24h', 'open 24h'), true)
  assert.equal(sameValue(6, 7), false)
  assert.equal(sameValue(null, null), true)
  assert.equal(sameValue(null, 0), false)
})

test('the diff reports changed, unchanged and no-target separately', () => {
  const incoming = [
    { roomSlug: 'aria', table: 'cash_games', stakesLabel: '$1/2', field: 'rake_cap', value: 7 },
    { roomSlug: 'aria', table: 'cash_games', stakesLabel: '$1/2', field: 'rake_percent', value: 10 },
    { roomSlug: 'aria', table: 'cash_games', stakesLabel: '$99/99', field: 'rake_cap', value: 5 },
  ]
  const current = [
    { roomSlug: 'aria', table: 'cash_games', stakesLabel: '$1/2', field: 'rake_cap', value: '6.00', targetId: 'r1' },
    { roomSlug: 'aria', table: 'cash_games', stakesLabel: '$1/2', field: 'rake_percent', value: '10.00', targetId: 'r1' },
  ]
  const d = diff(incoming, current)
  assert.equal(d.changes.length, 1)
  assert.equal(d.changes[0].from, '6.00')
  assert.equal(d.unchanged, 1, 'the 10% that already matched is not proposed again')
  assert.equal(d.noTarget.length, 1, 'a stakes row we do not hold is reported, never invented')
})

test('rake fields for one row batch together; everything else stays single', () => {
  /* rake_model_coherent makes "this room gains a rake" unrepresentable one
     field at a time, so the batch is what makes it expressible at all. */
  const changes = [
    { roomSlug: 'aria', table: 'cash_games', stakesLabel: '$1/2', field: 'rake_type', value: 'pot', targetId: 'r1', from: null },
    { roomSlug: 'aria', table: 'cash_games', stakesLabel: '$1/2', field: 'rake_cap', value: 6, targetId: 'r1', from: null },
    { roomSlug: 'aria', table: 'rooms', stakesLabel: null, field: 'table_count', value: 24, targetId: 'x1', from: 20 },
  ]
  const b = batch(changes)
  const grouped = b.find((g) => g.length > 1)
  assert.ok(grouped, 'the rake model and its cap travel together')
  assert.equal(grouped.length, 2)
  assert.equal(b.filter((g) => g.length === 1).length, 1)
})

test('rake changes on DIFFERENT rows do not merge into one group', () => {
  /* A group is applied as one row's model; two rows in a batch would interleave
     and the ordering guarantee would stop being true. */
  const changes = [
    { roomSlug: 'aria', table: 'cash_games', stakesLabel: '$1/2', field: 'rake_cap', value: 6, targetId: 'r1', from: null },
    { roomSlug: 'aria', table: 'cash_games', stakesLabel: '$2/5', field: 'rake_cap', value: 8, targetId: 'r2', from: null },
  ]
  const b = batch(changes)
  assert.equal(b.length, 2)
})
