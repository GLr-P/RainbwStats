// Bundled dataset (same shape as the remote one on GitHub Pages: data/meta/latest.json).
// `baseline` is a hand-curated 0..1 strength prior per operator, used only until replay data
// exists. It is shown as "baseline" in the UI. Never present it as measured data.
import type { CatalogOverrides } from '../catalog'

export interface Dataset extends CatalogOverrides {
  version: string
  season: string
  baseline: Record<string, number> // operator key → 0..1
  mapBaseline?: Record<string, Record<string, number>> // map key → operator key → 0..1 (overrides baseline)
  rankNames?: string[]
}

export const BUNDLED_DATASET: Dataset = {
  version: '2026.10.19-1',
  season: 'Y11S3',
  baseline: {
    // attack
    ace: 0.85, thermite: 0.8, hibana: 0.75, thatcher: 0.7, maverick: 0.55, kali: 0.6, twitch: 0.65, zero: 0.6,
    brava: 0.65, iana: 0.65, dokkaebi: 0.55, deimos: 0.55, sens: 0.5, grim: 0.6, ash: 0.65, sledge: 0.65, buck: 0.6,
    zofia: 0.6, striker: 0.6, ram: 0.6, flores: 0.5, nomad: 0.55, gridlock: 0.55, jackal: 0.55, lion: 0.5, finka: 0.55,
    capitao: 0.5, ying: 0.5, fuze: 0.5, blitz: 0.45, montagne: 0.4, osa: 0.55, nokk: 0.5, amaru: 0.5, glaz: 0.45,
    iq: 0.5, blackbeard: 0.45, rauora: 0.5, solidsnake: 0.6,
    // defense
    mute: 0.75, bandit: 0.7, kaid: 0.65, jager: 0.7, wamai: 0.65, valkyrie: 0.7, maestro: 0.65, melusi: 0.65,
    smoke: 0.7, mira: 0.7, azami: 0.7, echo: 0.6, thunderbird: 0.65, doc: 0.6, rook: 0.55, vigil: 0.5, caveira: 0.55,
    lesion: 0.6, ela: 0.55, aruni: 0.65, thorn: 0.55, goyo: 0.55, kapkan: 0.45, frost: 0.55, castle: 0.5, pulse: 0.5,
    alibi: 0.45, clash: 0.4, tachanka: 0.5, warden: 0.5, mozzie: 0.55, oryx: 0.5, solis: 0.55, fenrir: 0.55,
    tubarao: 0.6, sentry: 0.5, skopos: 0.5, denari: 0.55
  }
}
