// Phone-to-PC sync. Your list always travels straight from one device to the other over the
// local network (no STUN or TURN servers are configured on purpose).
//
// Two ways to introduce the devices:
//  1. A 6-character code. A free public PeerJS broker only passes the two devices' connection
//     details to each other for a few seconds. It never sees your list.
//  2. Two long copy-and-paste codes, which need no server at all (fallback).
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHUNK = 12000;

// Messages are cut into small pieces so big lists (with photos) fit through the data channel.
function frames(obj) {
  const s = JSON.stringify(obj);
  const id = Math.random().toString(36).slice(2);
  const n = Math.ceil(s.length / CHUNK) || 1;
  return Array.from({ length: n }, (_, i) => JSON.stringify({ id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
}

function reassembler(onData) {
  const parts = new Map();
  return raw => {
    try {
      const p = JSON.parse(raw);
      const a = parts.get(p.id) || [];
      a[p.i] = p.d;
      parts.set(p.id, a);
      if (a.filter(x => x !== undefined).length === p.n) {
        parts.delete(p.id);
        onData(JSON.parse(a.join('')));
      }
    } catch { /* ignore a malformed message */ }
  };
}

/* ---------- 6-character code (PeerJS broker) ---------- */

const PEER_SRC = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PEER_SRI = 'sha384-nlUQ8ZqCbvStErob+biJNzSgltf6urV3VGqhfIfzhmg9RXmpeRm76ELw0pYnKlTR';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L, so nothing is mistaken for something else
const PREFIX = 'wishbone-';
const EXPIRES_MS = 5 * 60 * 1000;

export const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % ALPHABET.length]).join('');
export const normCode = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

let peerLib;
const loadPeer = () => (peerLib ||= new Promise((res, rej) => {
  if (window.Peer) return res(window.Peer);
  const s = document.createElement('script');
  s.src = PEER_SRC; s.integrity = PEER_SRI; s.crossOrigin = 'anonymous';
  s.onload = () => res(window.Peer);
  s.onerror = () => { peerLib = null; rej(new Error('Could not load the sync helper')); };
  document.head.append(s);
}));

// onAsk(allow, deny) is called on the device showing the code when another device connects.
export function createShortSession({ onState, onData, onAsk }) {
  let peer, conn, allowed = false, opened = false, hosting = false, expiry;
  const feed = reassembler(onData);
  const options = { config: { iceServers: [] }, debug: 0 };
  const OK = 'wishbone-ok'; // the code owner sends this once they tap Allow

  const ready = () => {
    if (!(allowed && conn && conn.open && !opened)) return;
    opened = true;
    if (hosting) {
      conn.send(OK);
      if (peer.open) peer.disconnect(); // the broker is no longer needed, and the code is spent
    }
    onState('open');
  };
  function wire(c) {
    conn = c;
    c.on('open', () => (hosting || allowed ? ready() : onState('waiting')));
    c.on('data', d => {
      if (!hosting && d === OK) { allowed = true; return ready(); } // the other device allowed us
      if (allowed) feed(d); // ignore everything until the owner taps Allow
    });
    c.on('close', () => onState('closed'));
    c.on('error', () => onState('failed'));
  }

  return {
    // Shows a code; resolves with it once the broker has registered it.
    async host() {
      const Peer = await loadPeer();
      hosting = true;
      for (let tries = 0; tries < 5; tries++) {
        const code = newCode();
        try {
          let registered = false;
          await new Promise((res, rej) => {
            peer = new Peer(PREFIX + code, options);
            peer.on('open', () => { registered = true; res(); });
            peer.on('error', e => (registered && e.type !== 'unavailable-id' ? onState('failed') : rej(e)));
          });
        } catch (e) { peer.destroy(); if (e.type === 'unavailable-id') continue; throw e; }
        peer.on('connection', c => {
          if (conn) return c.close(); // one device per code
          clearTimeout(expiry);
          wire(c); // stays registered with the broker until the link is open, so it can answer
          onAsk(() => { allowed = true; ready(); }, () => { c.close(); peer.destroy(); onState('denied'); });
        });
        expiry = setTimeout(() => { if (!conn) { peer.destroy(); onState('expired'); } }, EXPIRES_MS);
        return code;
      }
      throw new Error('No free code');
    },
    async join(code) {
      const Peer = await loadPeer();
      peer = new Peer(undefined, options);
      peer.on('error', e => onState(e.type === 'peer-unavailable' ? 'badcode' : 'failed'));
      peer.on('open', () => {
        wire(peer.connect(PREFIX + normCode(code), { serialization: 'json', reliable: true }));
      });
      setTimeout(() => { if (!opened) onState('failed'); }, 25000);
    },
    async send(obj) {
      for (const f of frames(obj)) {
        while (conn.dataChannel && conn.dataChannel.bufferedAmount > 1e6) await sleep(40);
        conn.send(f);
      }
    },
    close() { clearTimeout(expiry); try { conn && conn.close(); peer && peer.destroy(); } catch { /* already closed */ } },
  };
}

/* ---------- long copy-and-paste codes (no server at all) ---------- */

async function pack(o) {
  const stream = new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  let bin = '';
  for (const x of new Uint8Array(await new Response(stream).arrayBuffer())) bin += String.fromCharCode(x);
  return 'WB1.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unpack(code) {
  const c = String(code).replace(/\s+/g, '');
  if (!c.startsWith('WB1.')) throw new Error('bad code');
  const u = Uint8Array.from(atob(c.slice(4).replace(/-/g, '+').replace(/_/g, '/')), x => x.charCodeAt(0));
  const text = await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  const o = JSON.parse(text);
  if (typeof o.sdp !== 'string' || o.sdp.length > 20000) throw new Error('bad code');
  return o;
}

const iceDone = pc => new Promise(res => {
  if (pc.iceGatheringState === 'complete') return res();
  const t = setTimeout(res, 4000);
  pc.addEventListener('icegatheringstatechange', () => {
    if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); }
  });
});

export function createSession({ onState, onData }) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const feed = reassembler(onData);
  let ch, opened = false;

  function attach(c) {
    ch = c;
    c.onopen = () => { opened = true; onState('open'); };
    c.onclose = () => onState('closed');
    c.onmessage = e => feed(e.data);
  }

  const watch = () => setTimeout(() => { if (!opened) onState('failed'); }, 25000);
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') onState('failed'); };

  return {
    async host() {
      attach(pc.createDataChannel('wishbone'));
      await pc.setLocalDescription(await pc.createOffer());
      await iceDone(pc);
      return pack({ t: 'offer', sdp: pc.localDescription.sdp });
    },
    async acceptReply(code) {
      const o = await unpack(code);
      if (o.t !== 'answer') throw new Error('not a reply code');
      await pc.setRemoteDescription({ type: 'answer', sdp: o.sdp });
      watch();
    },
    async join(code) {
      pc.ondatachannel = e => attach(e.channel);
      const o = await unpack(code);
      if (o.t !== 'offer') throw new Error('not a pairing code');
      await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await iceDone(pc);
      watch();
      return pack({ t: 'answer', sdp: pc.localDescription.sdp });
    },
    async send(obj) {
      for (const f of frames(obj)) {
        while (ch.bufferedAmount > 1e6) await sleep(40);
        ch.send(f);
      }
    },
    close() { try { ch && ch.close(); pc.close(); } catch { /* already closed */ } },
  };
}
