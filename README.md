# Phone Compose

A music composition web app for phones. The main interface is standard music notation: a treble staff
you write on by tapping, in the spirit of BeepBox but with real notes instead of a piano roll.

## What works now

- **Create song** from the home screen or the ☰ menu: title, tempo, time signature (2/4 to 6/4), key
  (C, G, D, A, E, F, B♭, E♭, A♭ major), number of measures and an instrument. Songs autosave to the
  browser (localStorage) and are listed on the home screen.
- **The staff**: treble clef, key signature and time signature, drawn in SVG with the
  [Bravura](https://github.com/steinbergmedia/bravura) SMuFL font. Measures scroll sideways; the `+` at the
  end adds a measure. Empty beats show quarter rests.
- **Note lengths, MuseScore style**: a palette under the score picks whole, half, quarter, eighth or
  sixteenth, plus dotted or triplet. Empty beats show rests: press a rest and a ghost note of the chosen
  length appears with its pitch name; slide up or down to pick the pitch, let go to write it (it sounds as
  you go). A longer note overwrites what it covers; a note that would cross the barline is refused.
  Pitches follow the key signature. Eighths and sixteenths in a beat are beamed, triplets get a 3.
- **Chords**: press on an existing note's column to add a pitch to it (seconds are engraved on both sides
  of the stem). Chord symbols (C, Am7, G7/B…) are printed above the staff when three or more different
  notes sound together.
- **Chord picker**: the Chord button opens a sheet with the chords of the song's key (I ii iii IV V vi
  vii°), any root (with ♭/♯), 15 chord types (major, minor, 7, maj7, m7, dim, aug, sus2/4, 6, m6, m7♭5,
  dim7, add9, 9) and the bass note (root position or 1st/2nd/3rd inversion), with a preview. Chords are
  spelled properly and voiced in close position on the staff. With a note selected it replaces that
  chord (keeping its length); otherwise it turns on chord input: tapping a rest writes the chord at the
  selected length, with its bass near where you press (slide to move it up or down).
- **Ties and slides**: select a note and press the tie button to connect it to the next position (writing
  the same pitch there if it's a rest, across barlines too). Same pitch: a tie, played as one long note.
  Drag the tied note up or down and it becomes a slide: drawn as a glissando line and played as a pitch
  glide over the second half of the first note. Tying into a chord without that pitch slides to its
  nearest note.
- **Tracks**: a song has any number of tracks, each with its own instrument, clef and notes. The tabs
  above the staff pick the track you edit; tap the active tab for its instrument, clef, mute and delete.
  Key, time signature and length are shared. All unmuted tracks play together, and MIDI export writes
  one MIDI track per track, each on its own channel.
- **Sharps and flats**: with a note selected, ♭ ♮ ♯ set its accidental; with nothing selected they set the
  accidental for the notes you write next (tap again to go back to the key signature). Accidentals are
  printed as in standard notation: they carry through the measure and naturals cancel them.
- **Clefs**: treble, bass, alto, treble 8vb (guitar) and bass 8vb (double bass). Choosing an instrument
  switches to its usual clef (viola → alto, cello → bass, guitar → treble 8vb, acoustic bass → bass 8vb);
  the ☰ menu can override it. Notes keep their pitch when the clef changes.
- **Grand staff**: pianos (and electric piano, harpsichord) are written on a treble and a bass staff
  braced together, each its own voice with its own rhythm (right and left hand), lined up so notes that
  sound together sit together. It can be turned on or off in the track's settings. With chord input,
  tapping the treble staff writes the chord in the right hand and drops its bass note (the inversion's
  bass) an octave or so lower into the bass clef; tapping the bass staff writes the whole chord there.
  The chord symbol names what both hands play together.
- **Arrange** (✦ on the top bar): work at the level of the song.
  - **Chords**: a chord lane above the score shows the progression; tap it at any bar or beat to set a
    chord there (it lasts until the next one). Chords can be suggested from a melody (the chord of the key
    that best fits each bar) or filled from common progressions (I–V–vi–IV, ii–V–I, …).
  - **Parts**: write a supporting part from the progression into a track (or a new one): block chords,
    comping, arpeggios, Alberti bass, bass roots, root–fifth, walking bass or scale runs, in a chosen
    rhythm and range of bars. It is written as ordinary notes, so you can change anything afterwards;
    writing again replaces those bars.
  - **Phrases**: choose bars (highlighted on the score), then repeat them right after, copy them to
    another track (fitted to its range, an octave up or down, or as a diatonic harmony a 3rd or 6th
    away), or name and save them to insert anywhere later.
- **Editing**: tap a note to select it; the palette then changes that chord's length and 🗑 deletes the
  note. Drag a note up or down to move it. Undo with ↶.
- **Playback**: play/stop, looping, a playhead that the score follows, and a tempo stepper. Timing comes
  from the [Tone.js](https://tonejs.github.io/) Transport.
- **Real instruments** via [smplr](https://github.com/danigb/smplr): a grand piano (Splendid Grand Piano)
  plus strings, winds, brass, guitar, choir and more from the FluidR3 General MIDI soundfont
  ([midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts)). Samples download the first time an
  instrument is used (about 1 MB per instrument; the piano loads only the range the staff can hold) and
  are cached by the browser. A few Tone.js synths (chip square, saw, FM bell…) need no download.
- **Export MIDI**: the ☰ menu writes a standard `.mid` file (via `@tonejs/midi`) with the song's General
  MIDI instrument, so it sounds similar in other apps.

## Develop

```sh
npm install
npm run dev        # Vite on your network, so you can open it on your phone
npm test           # unit tests (vitest)
npm run typecheck
npm run build      # static site in dist/ (relative paths; works on GitHub Pages)
```

## Deploy

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to `main`.
One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. The site is then at
`https://<owner>.github.io/phone-compose/`.

## Sound credits and licenses

The samples are downloaded at runtime from the projects' own hosting (GitHub Pages), not bundled here.
FluidR3_GM is MIT-licensed; check the [Splendid Grand Piano](https://github.com/sfzinstruments/SplendidGrandPiano)
repository for its terms before distributing it in other ways.

## Layout

- `src/music/theory.ts` — pitch math: diatonic steps, key signatures, staff positions.
- `src/music/duration.ts` — note lengths in ticks (48 per quarter), dotted/triplet values, rest filling.
- `src/music/clefs.ts` — clefs and how they map pitches to staff positions.
- `src/music/chords.ts` — chord symbol naming.
- `src/music/chordBuilder.ts` — building chords from root, type and inversion; chords of a key.
- `src/music/progression.ts` — the chord progression, presets and suggesting chords for a melody.
- `src/music/arrange.ts` — generating supporting parts from the progression.
- `src/music/phrases.ts` — taking, transposing and inserting phrases.
- `src/music/song.ts` — the song model (a song of tracks; a Part is one track with the song's settings,
  which is what the staff edits) and pure editing functions (place / move / remove notes, change
  lengths, ties, accidentals, key, meter, instrument and clef). Songs saved before note lengths existed are upgraded on load.
- `src/music/storage.ts` — saving songs in localStorage.
- `src/music/instruments.ts` — the instrument list: smplr sample sets, synths, General MIDI programs.
- `src/audio/player.ts` — playback and note previews (Tone.js timing, smplr or Tone.js sound). Slides on
  sampled instruments ramp the pitch of smplr's audio source, caught as smplr creates it.
- `src/audio/midiExport.ts` — MIDI file export.
- `src/components/staffLayout.ts` — horizontal layout (staves of a grand staff aligned), beaming and
  triplet groups.
- `src/components/Staff.tsx` — the notation view: `Score` (one or two staves scrolling together) and
  `StaffRow` (drawing and touch input for one staff).
- `src/components/DurationPalette.tsx` — the note-length palette.
- `src/components/ChordPicker.tsx` — the chord picker sheet.
- `src/components/TrackBar.tsx` — the track tabs.
- `src/components/ArrangeSheet.tsx` — the Arrange sheet (chords, parts, phrases).
- `src/components/Editor.tsx`, `Home.tsx`, `NewSongForm.tsx` — screens and menus.

Notes store a diatonic step plus an alteration rather than a MIDI number, so the score can always be
spelled correctly (this is what lets accidentals, other durations and other clefs be added later).
