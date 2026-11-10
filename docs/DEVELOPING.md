# Developing Wishbone

Plain HTML, CSS, and JavaScript (ES modules). No build step and no dependencies.

## Run it locally

```
node dev-server.mjs 8080
```

Open http://localhost:8080. Service workers only run on `localhost` or HTTPS.
The service worker serves cached files first, so after editing code, hard-reload or unregister it in DevTools (Application, Service Workers).

## Test

```
npm test
```

Runs `tests/merge.test.mjs`: the sync merge rules (newest edit wins, deletes survive, untrusted data is rebuilt).

## Host it (GitHub Pages)

Push the repo, then Settings, Pages, deploy from the `main` branch root. Everything uses relative paths, so it works from `https://<user>.github.io/<repo>/`.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `css/style.css` | The page and all styling (light and dark themes via CSS variables) |
| `js/app.js` | The interface: wall, list, add and edit sheet, paste handling, sync screens, backup |
| `js/db.js` | IndexedDB storage and the merge and validation rules |
| `js/sync.js` | Direct device-to-device sync (WebRTC data channel, no server) |
| `sw.js`, `manifest.webmanifest` | Offline support and installability |
| `icons/` | App icon (SVG source and PNG sizes) |
| `docs/hero.html` | Source for the README hero images in `docs/screenshots/` |

## How sync works

There is no server. Two devices open a WebRTC data channel and find each other by swapping two copy-and-paste codes (an offer and an answer). No STUN or TURN servers are configured on purpose, so it only works on the same local network. Once connected, each side sends all its wishes, and each wish is kept by the newest `updatedAt`. Deleted wishes stay as small tombstones so deletes sync too. Everything received is rebuilt field by field in `clean()` before it is stored.

People are their own records. A person's id comes from their name (`p-mom`), so adding the same name on two devices gives one person after sync. A wish's `for` list holds person ids; an empty list means it's for me, and only those wishes count toward "Still wishing for". People are merged before wishes.

## Known limits

- Every sync needs the two-code pairing again; devices don't stay paired.
- Browsers that hide local IPs behind mDNS names usually still connect on a home network, but some routers block it.
- Photos are shrunk to 800 px JPEG and stored inside each wish; a very large list means a large backup file.
