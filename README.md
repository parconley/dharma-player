# Dharma Player

A clean, Spotify-style desktop player for the [Dharma Seed](https://dharmaseed.org) archive of ~49,000 Buddhist dharma talks. It runs locally on your own machine.

- Browse and search every talk, teacher, and retreat (instant, diacritic-insensitive search: `jhana` finds *Jhāna*)
- Pin teachers to the sidebar (drag to reorder), like talks, history, and a play queue
- Resumes every talk where you left off
- Variable speed 0.5×–3× from the keyboard, plus a sleep timer that fades out
- Download talks or whole retreats for offline listening
- Always-on-top mini player, so it never gets lost behind other windows

## Run it

Requires [Node.js](https://nodejs.org) 18+. There are no dependencies to install.

```
node server.js
```

Then open http://localhost:4747. The first launch downloads the catalog from Dharma Seed (about a minute).

**Windows:** double-click `Dharma Player.vbs`. It starts the server in the background and opens the player in its own app window (Chrome or Edge, no tabs).

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
