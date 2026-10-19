// Operator seed data. IDs are Dissect replay IDs (uint64 as decimal strings).
// The remote dataset can add/override entries (new seasons) without an app update.
import type { Side } from '../types'

/** Role tags used for team-composition fit.
 *  Attack: hb hard breach · sb soft/vertical breach · uc utility clear · in intel · fl flank watch/denial
 *          sh shield · pl plant support · en entry/frag
 *  Defense: ah anti hard-breach · ap anti-projectile · in intel · ro roam · an anchor · tr trap
 *           de area denial · rf reinforce/structure · su support/heal */
export type RoleTag = 'hb' | 'sb' | 'uc' | 'in' | 'fl' | 'sh' | 'pl' | 'en' | 'ah' | 'ap' | 'ro' | 'an' | 'tr' | 'de' | 'rf' | 'su'

export interface OperatorInfo {
  id: string
  /** Stable key (lowercase ascii), used in settings/roster. */
  key: string
  name: string
  side: Side
  roles: RoleTag[]
}

// name | dissect id | a/d | roles
const RAW = `
Sledge|92270642344|a|sb,en
Thatcher|92270642422|a|uc
Ash|92270642656|a|sb,en
Thermite|92270642760|a|hb
Twitch|92270644111|a|uc,in
Montagne|92270644033|a|sh
Glaz|92270642084|a|en
Fuze|92270642032|a|uc,sb
Blitz|92270642539|a|sh,en
IQ|92270642578|a|in,uc
Buck|92270642474|a|sb,en
Blackbeard|92270642136|a|en
Capitao|92270644215|a|pl,de
Hibana|92270642240|a|hb
Jackal|92270644345|a|in
Ying|92270642292|a|en,pl
Zofia|92270644189|a|sb,en
Dokkaebi|92270644267|a|in
Lion|104189661861|a|in
Finka|104189661965|a|en
Maverick|104189662384|a|hb
Nomad|161289666248|a|fl
Gridlock|174977508808|a|fl,pl
Nokk|104189663024|a|en
Amaru|104189663607|a|en
Kali|104189663920|a|uc
Iana|104189664038|a|in
Ace|104189664390|a|hb
Zero|291191151607|a|in,uc
Flores|328397386974|a|uc
Osa|288200867444|a|sh
Sens|384797789346|a|pl
Grim|374667788042|a|in
Brava|288200866821|a|uc,in
Ram|395943091136|a|sb,uc
Deimos|374667787816|a|in,en
Striker|409899350463|a|en
Rauora|386098331923|a|sb
Solid Snake|444310693746|a|in,en
Smoke|92270642396|d|de,an
Mute|92270642318|d|ah,in
Castle|92270642682|d|rf
Pulse|92270642708|d|in,ro
Doc|92270644007|d|su,an
Rook|92270644059|d|su,an
Kapkan|92270641980|d|tr
Tachanka|291437347686|d|de,an
Jager|92270642604|d|ap,an
Bandit|92270642526|d|ah,ro
Frost|92270642500|d|tr,an
Valkyrie|92270642188|d|in
Caveira|92270644241|d|ro
Echo|92270642214|d|in,de
Mira|92270644319|d|rf,an
Lesion|92270642266|d|tr,ro
Ela|92270644163|d|tr,ro
Vigil|92270644293|d|ro
Maestro|104189662175|d|in,an
Alibi|104189662071|d|ro
Clash|104189662280|d|de,an
Kaid|161289666230|d|ah,an
Mozzie|174977508820|d|in,ro
Warden|104189662920|d|an
Goyo|104189663698|d|de,an
Wamai|104189663803|d|ap,an
Oryx|104189664155|d|ro
Melusi|104189664273|d|tr,in
Aruni|104189664704|d|tr,ah
Thunderbird|288200867351|d|su,an
Thorn|373711624351|d|tr,an
Azami|378305069945|d|rf,an
Solis|391752120891|d|in,ro
Fenrir|288200867339|d|de,an
Tubarao|288200867549|d|de,an
Sentry|409899350403|d|an
Skopos|386098331713|d|in,an
Denari|374667787937|d|de,an
Noor|x:noor|d|de,an
`

export const RECRUIT_ID = '359656345734'

export const OPERATORS: OperatorInfo[] = RAW.trim().split('\n').map((line) => {
  const [name, id, side, roles] = line.split('|') as [string, string, string, string]
  return { id, name, key: name.toLowerCase().replace(/[^a-z0-9]/g, ''), side: side === 'a' ? 'attack' : 'defense', roles: roles.split(',') as RoleTag[] }
})
