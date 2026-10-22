# Dharma Player

A clean, Spotify-style desktop player for the [Dharma Seed](https://dharmaseed.org) archive of ~49,000 Buddhist dharma talks. It runs locally on your own machine.

- Browse and search every talk, teacher, and retreat (instant, diacritic-insensitive search: `jhana` finds *Jhāna*)
- Pin teachers to the sidebar (drag to reorder), like talks, history, and a play queue
- Resumes every talk where you left off
- Variable speed 0.5×–3× from the keyboard, plus a sleep timer that fades out
- Download talks or whole retreats for offline listening
- Always-on-top mini player, so it never gets lost behind other windows

## Desktop app (Windows)

```
npm install
npm run dist
```

This produces `dist/Dharma Player Setup 1.0.0.exe`, an installer that adds Start Menu and desktop shortcuts, and `dist/Dharma Player Portable.exe`, a single file you can run from anywhere. The app is an [Electron](https://www.electronjs.org) shell around the same local server and UI. Your library lives in `%APPDATA%\Dharma Player\data`.

`npm start` runs the desktop app from source.

## In a browser

Requires [Node.js](https://nodejs.org) 18+:

```
node server.js
```

Then open http://localhost:4747. The first launch downloads the catalog from Dharma Seed (about a minute). On Windows, `Dharma Player.vbs` starts the server and opens it in a Chrome app window.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `←` / `J` | Back 15 s |
| `→` / `L` | Forward 30 s |
| `+` / `−` | Speed ±0.1× |
| `>` / `<` | Speed ±0.25× |
| `R` | Reset speed to 1× |
| `↑` / `↓` | Volume |
| `M` | Mute |
| `0`–`9` | Jump to 0–90% |
| `N` / `P` | Next / previous talk |
| `I` | Mini player (floats on top) |
| `/` | Search |
| `?` | Show shortcuts |

## How it works

`server.js` syncs talk metadata from Dharma Seed's public API into `data/catalog.json`, checks for new talks every 6 hours, and fully refreshes monthly. Your library (likes, follows, progress) is kept in `data/library.json`, and downloads in `data/audio/`. Audio streams from Dharma Seed unless the talk is downloaded. The server binds to `127.0.0.1` only.

## Credit

All talks are hosted and generously shared by [Dharma Seed](https://dharmaseed.org). This is an unofficial client and isn't affiliated with Dharma Seed. If you find it useful, please [support them](https://dharmaseed.org/donate/).
