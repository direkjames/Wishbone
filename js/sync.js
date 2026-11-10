// Phone-to-PC sync with no server: a direct WebRTC connection between two devices on the
// same network. The two devices swap one pairing code each (copy and paste) to find each other.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHUNK = 12000;

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
  // No STUN/TURN servers on purpose: this only ever works on the local network.
  const pc = new RTCPeerConnection({ iceServers: [] });
  const parts = new Map();
  let ch, opened = false;

  function attach(c) {
    ch = c;
    c.bufferedAmountLowThreshold = 256000;
    c.onopen = () => { opened = true; onState('open'); };
    c.onclose = () => onState('closed');
    c.onmessage = e => {
      try {
        const p = JSON.parse(e.data);
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
      const s = JSON.stringify(obj);
      const id = Math.random().toString(36).slice(2);
      const n = Math.ceil(s.length / CHUNK) || 1;
      for (let i = 0; i < n; i++) {
        while (ch.bufferedAmount > 1e6) await sleep(40);
        ch.send(JSON.stringify({ id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
      }
    },
    close() { try { ch && ch.close(); pc.close(); } catch { /* already closed */ } },
  };
}
