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
- **Quarter notes**: press a beat and a ghost note with its pitch name appears; slide up or down to pick
  the pitch, let go to place it (sounds as you go). Pitches follow the key signature. Several notes on one
  beat make a chord (seconds are engraved on both sides of the stem). Tap a note to remove it, or drag it
  up and down to move it. Undo with ↶.
- **Playback** with [Tone.js](https://tonejs.github.io/): play/stop, looping, a playhead that the score
  follows, tempo stepper and a few chip-style instruments.
- **Export MIDI**: the ☰ menu writes a standard `.mid` file (via `@tonejs/midi`).

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

## Layout

- `src/music/theory.ts` — pitch math: diatonic steps, key signatures, staff positions.
- `src/music/song.ts` — the song model and pure editing functions (add / move / remove notes, key, meter).
- `src/music/storage.ts` — saving songs in localStorage.
- `src/audio/player.ts` — Tone.js playback and note previews.
- `src/audio/midiExport.ts` — MIDI file export.
- `src/components/Staff.tsx` — the notation view and its touch input.
- `src/components/Editor.tsx`, `Home.tsx`, `NewSongForm.tsx` — screens and menus.

Notes store a diatonic step plus an alteration rather than a MIDI number, so the score can always be
spelled correctly (this is what lets accidentals, other durations and other clefs be added later).
