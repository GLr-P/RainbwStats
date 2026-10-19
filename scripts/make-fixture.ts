// Builds test/fixtures/rounds-sample.json from local replays with names and IDs scrubbed.
// Usage: npx tsx scripts/make-fixture.ts <matchDir>
import { writeFileSync } from 'node:fs'
import { listRoundFiles, parseFile } from '../src/main/replay/ingest'
import { normalizeRound } from '../src/main/replay/normalize'

const ids = new Map<string, string>()
const fake = (id: string) => {
  if (!ids.has(id)) ids.set(id, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`)
  return ids.get(id)!
}
const rounds = listRoundFiles(process.argv[2]!).map((f) => {
  const r = normalizeRound(parseFile(f))
  r.recordingProfileId = fake(r.recordingProfileId)
  r.matchId = 'fixture-match-1'
  for (const p of r.players) { p.profileId = fake(p.profileId); p.username = `Player${p.profileId.slice(-2)}` }
  return r
})
writeFileSync('test/fixtures/rounds-sample.json', JSON.stringify(rounds, null, 1) + '\n')
console.log(`wrote ${rounds.length} rounds`)
