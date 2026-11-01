// The instruments a song can use. Sampled ones are played with smplr
// (recorded instruments, downloaded on first use); synths are Tone.js
// oscillators that need no download. `program` is the General MIDI
// instrument number written to exported MIDI files.

export type InstrumentSource =
  | { kind: 'piano' } // smplr SplendidGrandPiano
  | { kind: 'soundfont'; name: string } // smplr Soundfont, gleitz/midi-js-soundfonts name
  | { kind: 'synth'; synth: 'square' | 'triangle' | 'sawtooth' | 'bell' | 'organ' }

import type { ClefId } from './clefs'

export interface InstrumentDef {
  id: string
  /** The clef this instrument is usually written in. */
  clef: ClefId
  name: string
  group: 'Instruments' | 'Synths'
  program: number
  source: InstrumentSource
}

const sf = (id: string, name: string, program: number, sfName = id, clef: ClefId = 'treble'): InstrumentDef => ({
  id,
  clef,
  name,
  group: 'Instruments',
  program,
  source: { kind: 'soundfont', name: sfName },
})
const synth = (id: 'square' | 'triangle' | 'sawtooth' | 'bell' | 'organ', name: string, program: number): InstrumentDef => ({
  id,
  clef: 'treble',
  name,
  group: 'Synths',
  program,
  source: { kind: 'synth', synth: id },
})

export const INSTRUMENTS: InstrumentDef[] = [
  { id: 'piano', clef: 'treble', name: 'Grand piano', group: 'Instruments', program: 0, source: { kind: 'piano' } },
  sf('electric_piano', 'Electric piano', 4, 'electric_piano_1'),
  sf('harpsichord', 'Harpsichord', 6),
  sf('music_box', 'Music box', 10),
  sf('marimba', 'Marimba', 12),
  sf('nylon_guitar', 'Nylon guitar', 24, 'acoustic_guitar_nylon', 'treble8vb'),
  sf('acoustic_bass', 'Acoustic bass', 32, 'acoustic_bass', 'bass8vb'),
  sf('violin', 'Violin', 40),
  sf('viola', 'Viola', 41, 'viola', 'alto'),
  sf('cello', 'Cello', 42, 'cello', 'bass'),
  sf('pizzicato_strings', 'Pizzicato strings', 45),
  sf('harp', 'Harp', 46, 'orchestral_harp'),
  sf('strings', 'String ensemble', 48, 'string_ensemble_1'),
  sf('choir', 'Choir', 52, 'choir_aahs'),
  sf('trumpet', 'Trumpet', 56),
  sf('french_horn', 'French horn', 60),
  sf('alto_sax', 'Alto sax', 65),
  sf('oboe', 'Oboe', 68),
  sf('clarinet', 'Clarinet', 71),
  sf('flute', 'Flute', 73),
  synth('square', 'Chip square', 80),
  synth('sawtooth', 'Saw lead', 81),
  synth('triangle', 'Soft triangle', 80),
  synth('bell', 'FM bell', 14),
  synth('organ', 'Organ', 16),
]

export const DEFAULT_INSTRUMENT = 'piano'

export function getInstrument(id: string): InstrumentDef {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0]
}
