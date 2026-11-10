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
| `js/theme.js` | Applies the saved theme before first paint (a file, not inline, so the CSP can forbid inline scripts) |
| `js/app.js` | The interface: wall, list, add and edit sheet, paste handling, sync screens, backup |
| `js/db.js` | IndexedDB storage and the merge and validation rules |
| `js/sync.js` | Direct device-to-device sync (WebRTC data channel, no server) |
| `sw.js`, `manifest.webmanifest` | Offline support and installability |
| `icons/` | App icon (SVG source and PNG sizes) |
| `docs/hero.html` | Source for the README hero images in `docs/screenshots/` |

## How sync works

Your data never goes through a server. Two devices open a WebRTC data channel and send each other everything over the local network. No STUN or TURN servers are configured on purpose, so it only works on the same local network.

Introducing the devices works two ways (`js/sync.js`):

1. **6-character code (default).** The device that shows the code registers the id `wishbone-<CODE>` with the free public PeerJS broker (PeerJS 1.5.4, loaded from jsDelivr with a Subresource Integrity hash, only when you open sync). The other device types the code and connects to that id. The broker only relays the connection setup. The code owner must tap **Allow**; the joining device sends nothing until it receives the owner's `wishbone-ok` message, and the owner ignores any data before Allow. A code works for one connection and expires after 5 minutes. The alphabet leaves out 0, O, 1, I and L.
2. **Long codes (fallback).** No server at all: the devices swap an offer and an answer by copy and paste.

Once connected, each side sends all its wishes, and each wish is kept by the newest `updatedAt`. Deleted wishes stay as small tombstones so deletes sync too. Everything received is rebuilt field by field in `clean()` before it is stored.

People are their own records. A person's id comes from their name (`p-mom`), so adding the same name on two devices gives one person after sync. A wish's `for` list holds person ids; an empty list means it's for me, and only those wishes count toward "Still wishing for". People are merged before wishes.

## Security notes

- `index.html` carries a Content-Security-Policy meta tag listing exactly the hosts the app uses (jsDelivr, Google Fonts, and the PeerJS broker). If you add a new outside host, add it there or the browser will block it. `form-action 'none'` is deliberate: every form is handled in JavaScript.
- Third-party files are pinned to an exact version and checked with a Subresource Integrity hash. When bumping one, recompute the hash (`sha384`, base64).
- Everything that comes from outside (synced data, backup files) goes through `clean()` and size caps before it is stored.
- User text is only ever added with `textContent` (the `h()` helper), never `innerHTML`.

## Known limits

- Every sync needs a new code; devices don't stay paired.
- The 6-character code depends on the free public PeerJS broker being up. If it's down, use the long code or a backup file.
- PeerJS 1.5.4 has no raw-string mode, so frames are sent with its `json` serialization.
- Browsers that hide local IPs behind mDNS names usually still connect on a home network, but some routers block it.
- Photos are shrunk to 800 px JPEG and stored inside each wish; a very large list means a large backup file.
