// Landing vs Room: do not auto-create a room; show landing when no hash

// UI elements
const els = {
  roomId: document.getElementById('roomId'),
  connStatus: document.getElementById('connStatus'),
  participants: document.getElementById('participants'),
  copyLinkBtn: document.getElementById('copyLinkBtn'),
  toggleMicBtn: document.getElementById('toggleMicBtn'),
  toggleCamBtn: document.getElementById('toggleCamBtn'),
  hangupBtn: document.getElementById('hangupBtn'),
  audioIn: document.getElementById('audioIn'),
  videoIn: document.getElementById('videoIn'),
  localVideo: document.getElementById('localVideo'),
  grid: document.getElementById('grid')
};

// Landing controls
const landing = document.getElementById('landing');
const startRoomBtn = document.getElementById('startRoomBtn');
const copyLinkLanding = document.getElementById('copyLinkLanding');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');

let roomHash = location.hash.substring(1);
if (roomHash) { els.roomId.textContent = roomHash; if (landing) landing.classList.add('hidden'); }
else { if (landing) landing.classList.remove('hidden'); }

// TODO: Replace with your own channel ID (currently demo)
let drone = null;
// Room name needs to be prefixed with 'observable-'
let roomName = roomHash ? 'observable-' + roomHash : null;
const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};
const MAX_PEERS = 5;
let room; let localStream; let ended = false;
const peerState = new Map(); // peerId -> { makingOffer, polite }
const peers = new Map(); // peerId -> RTCPeerConnection
const remoteTiles = new Map(); // peerId -> HTMLVideoElement

function setStatus(text, cls) {
  els.connStatus.textContent = text;
  els.connStatus.classList.remove('ok', 'warn', 'err');
  if (cls) els.connStatus.classList.add(cls);
}

function onSuccess() {}
function onError(error) { console.error(error); setStatus('error', 'err'); }

function setParticipants(count) {
  if (els.participants) els.participants.textContent = String(count);
}

// Copy invite link
els.copyLinkBtn?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    els.copyLinkBtn.textContent = 'Link Copied';
    setTimeout(() => (els.copyLinkBtn.textContent = 'Copy Invite Link'), 1500);
  } catch (_) {
    // fallback
    prompt('Copy this link', location.href);
  }
});

copyLinkLanding?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.origin + location.pathname); } catch (_) {}
});

startRoomBtn?.addEventListener('click', () => {
  roomHash = Math.floor(Math.random() * 0xFFFFFF).toString(16);
  location.hash = roomHash;
  begin();
});

joinBtn?.addEventListener('click', () => {
  const val = (roomInput?.value || '').trim();
  if (!val) return;
  try {
    if (val.includes('http')) {
      const url = new URL(val);
      location.href = url.origin + url.pathname + url.hash;
    } else {
      location.hash = val.replace(/^#/, '');
      begin();
    }
  } catch (_) {}
});

// List and update available devices
async function listDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audios = devices.filter(d => d.kind === 'audioinput');
    const videos = devices.filter(d => d.kind === 'videoinput');
    els.audioIn.innerHTML = audios.map(d => `<option value="${d.deviceId}">${d.label || 'Microphone'}</option>`).join('');
    els.videoIn.innerHTML = videos.map(d => `<option value="${d.deviceId}">${d.label || 'Camera'}</option>`).join('');
  } catch (e) { console.warn('enumerateDevices failed', e); }
}

async function switchTrack(kind, deviceId) {
  if (!localStream) return;
  const constraints = kind === 'videoinput' ? { video: { deviceId: { exact: deviceId } } } : { audio: { deviceId: { exact: deviceId } } };
  try {
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack = newStream.getTracks()[0];
    // Replace track on all peer connections
    peers.forEach((pc) => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === newTrack.kind);
      if (sender) sender.replaceTrack(newTrack);
    });
    // update local preview
    const oldTrack = localStream.getTracks().find(t => t.kind === newTrack.kind);
    if (oldTrack) { oldTrack.stop(); localStream.removeTrack(oldTrack); }
    localStream.addTrack(newTrack);
  } catch (e) { onError(e); }
}

els.audioIn?.addEventListener('change', (e) => switchTrack('audioinput', e.target.value));
els.videoIn?.addEventListener('change', (e) => switchTrack('videoinput', e.target.value));

// Toggle buttons
els.toggleMicBtn?.addEventListener('click', () => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  els.toggleMicBtn.setAttribute('aria-pressed', String(!track.enabled));
  els.toggleMicBtn.textContent = track.enabled ? 'Mute' : 'Unmute';
});

els.toggleCamBtn?.addEventListener('click', () => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  els.toggleCamBtn.setAttribute('aria-pressed', String(!track.enabled));
  els.toggleCamBtn.textContent = track.enabled ? 'Stop Video' : 'Start Video';
});

els.hangupBtn?.addEventListener('click', () => {
  try { peers.forEach(pc => pc.close()); peers.clear(); } catch {}
  localStream?.getTracks().forEach(t => t.stop());
  if (els.localVideo) els.localVideo.srcObject = null;
  // remove remote tiles
  remoteTiles.forEach((vid, id) => {
    const tile = document.getElementById(`tile-${id}`);
    tile?.remove();
  });
  remoteTiles.clear();
  if (!ended) {
    ended = true;
    setStatus('ended', 'warn');
    try { sendMessage({ endAll: true }); } catch {}
  }
});

async function ensureLocal() {
  if (localStream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream = stream;
    els.localVideo.srcObject = stream;
    await listDevices();
    if ((Number(els.participants?.textContent)||1) === 1) setStatus('waiting for peers', 'warn');
  } catch (e) { onError(e); }
}

function begin() {
  if (landing) landing.classList.add('hidden');
  if (!roomHash) roomHash = location.hash.substring(1);
  els.roomId.textContent = roomHash;
  roomName = 'observable-' + roomHash;
  drone = new ScaleDrone('yiS12Ts5RdNhebyM');
  attachDrone();
}

if (roomHash) { begin(); }

function attachDrone() {
drone.on('open', error => {
  if (error) { return onError(error); }
  room = drone.subscribe(roomName);
  room.on('open', async error => { if (error) onError(error); else { setStatus('connected to room', 'warn'); await ensureLocal(); } });
  // We're connected to the room and received an array of 'members'
  room.on('members', members => {
    console.log('MEMBERS', members);
    // Enforce max 5 participants (including self)
    if (members.length > MAX_PEERS) {
      setParticipants(members.length);
      setStatus('room full (max 5)', 'err');
      try { drone.close(); } catch {}
      return;
    }
    setParticipants(members.length);
    if (members.length === 1) setStatus('waiting for peers', 'warn');
    const myId = drone.clientId;
    // Create a connection for each existing member deterministically
    members
      .filter(m => m.id !== myId)
      .forEach(m => {
        const isOfferer = myId > m.id; // simple deterministic rule
        ensurePeer(m.id, isOfferer);
      });
  });

  room.on('member_join', member => {
    const current = Number(els.participants.textContent) || 1;
    if (current >= MAX_PEERS) {
      setStatus('capacity reached (5)', 'warn');
      return;
    }
    setParticipants(current + 1);
    // Deterministic offerer to prevent glare
    ensurePeer(member.id, drone.clientId > member.id);
  });

  room.on('member_leave', ({id}) => {
    setParticipants(Math.max(1, (Number(els.participants.textContent)||1) - 1));
    const pc = peers.get(id);
    if (pc) { try { pc.close(); } catch {} peers.delete(id); }
    const tile = document.getElementById(`tile-${id}`);
    if (tile) tile.remove();
    remoteTiles.delete(id);
  });
});
}

// Send signaling data via Scaledrone
function sendMessage(message, to) {
  const payload = Object.assign({}, message, { from: drone.clientId });
  if (to) payload.to = to;
  drone.publish({ room: roomName, message: payload });
}

function ensurePeer(peerId, isOfferer) {
  if (peers.has(peerId)) return peers.get(peerId);
  const pc = new RTCPeerConnection(configuration);
  peers.set(peerId, pc);
  peerState.set(peerId, { makingOffer: false, polite: (drone.clientId < peerId) });

  pc.addEventListener('connectionstatechange', () => {
    const s = pc.connectionState;
    if (s === 'connected') setStatus('connected', 'ok');
    else if (s === 'failed') setStatus('failed', 'err');
    else setStatus(s, s === 'connecting' ? 'warn' : undefined);
  });

  pc.onicecandidate = event => {
    if (event.candidate) sendMessage({ candidate: event.candidate }, peerId);
  };

  pc.ontrack = event => {
    const stream = event.streams[0];
    let vid = remoteTiles.get(peerId);
    if (!vid) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${peerId}`;
      vid = document.createElement('video');
      vid.autoplay = true; vid.playsInline = true; vid.setAttribute('playsinline','');
      tile.appendChild(vid);
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = peerId.slice(0, 6);
      tile.appendChild(label);
      els.grid.appendChild(tile);
      remoteTiles.set(peerId, vid);
    }
    if (!vid.srcObject || vid.srcObject.id !== stream.id) {
      vid.srcObject = stream;
    }
  };

  // Add our tracks if already available
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  if (isOfferer) {
    // Create offer after transceivers added
    const maybeOffer = async () => {
      const st = peerState.get(peerId); if (!st) return;
      try { st.makingOffer = true; const offer = await pc.createOffer(); await localDescCreated(pc, offer, peerId); }
      catch(e){ onError(e); } finally { st.makingOffer = false; }
    };
    if (!localStream) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(async stream => {
        localStream = stream;
        els.localVideo.srcObject = stream;
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        await listDevices();
        maybeOffer();
      }, onError);
    } else {
      maybeOffer();
    }
  } else {
    // Ensure we have local media for when answer is needed
    if (!localStream) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(async stream => {
        localStream = stream;
        els.localVideo.srcObject = stream;
        await listDevices();
      }, onError);
    }
  }

  return pc;
}

// Listen to signaling data from Scaledrone (room-level)
if (!room) {
  // no-op until room open handler sets it, but we keep scope readiness
}

// Attach data listener once room is defined
const attachRoomDataListener = () => {
  room.on('data', (message, client) => {
    if (client.id === drone.clientId) return; // ignore our own broadcast
    if (message.to && message.to !== drone.clientId) return; // not addressed to us
    if (message.endAll && !ended) {
      ended = true;
      els.hangupBtn?.click();
      setStatus('call ended', 'warn');
      return;
    }
    const peerId = message.from || client.id;
    let pc = peers.get(peerId);
    if (!pc) pc = ensurePeer(peerId, false);
    if (message.sdp) {
      const desc = new RTCSessionDescription(message.sdp);
      const st = peerState.get(peerId) || { makingOffer: false, polite: true };
      const offerCollision = desc.type === 'offer' && (st.makingOffer || pc.signalingState !== 'stable');
      const ignoreOffer = !st.polite && offerCollision;
      if (ignoreOffer) return;
      (offerCollision ? pc.setLocalDescription({ type: 'rollback' }) : Promise.resolve())
        .then(() => pc.setRemoteDescription(desc))
        .then(async () => {
          if (desc.type === 'offer') {
            const answer = await pc.createAnswer();
            await localDescCreated(pc, answer, peerId);
          } else if (desc.type === 'answer') {
            if (pc.signalingState !== 'have-local-offer') {
              return; // stale/unsolicited answer
            }
          }
        })
        .catch(onError);
    } else if (message.candidate) {
      pc.addIceCandidate(new RTCIceCandidate(message.candidate)).catch(onError);
    }
  });
};

// Defer attaching until room is available
const roomReady = setInterval(() => { if (room) { clearInterval(roomReady); attachRoomDataListener(); } }, 50);

function localDescCreated(pc, desc, toPeerId) {
  return pc.setLocalDescription(desc)
    .then(() => sendMessage({ sdp: pc.localDescription }, toPeerId))
    .catch(onError);
}
