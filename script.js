// Generate random room name if needed
if (!location.hash) {
  location.hash = Math.floor(Math.random() * 0xFFFFFF).toString(16);
}

// UI elements
const els = {
  roomId: document.getElementById('roomId'),
  connStatus: document.getElementById('connStatus'),
  copyLinkBtn: document.getElementById('copyLinkBtn'),
  toggleMicBtn: document.getElementById('toggleMicBtn'),
  toggleCamBtn: document.getElementById('toggleCamBtn'),
  hangupBtn: document.getElementById('hangupBtn'),
  audioIn: document.getElementById('audioIn'),
  videoIn: document.getElementById('videoIn'),
  localVideo: document.getElementById('localVideo'),
  remoteVideo: document.getElementById('remoteVideo')
};

const roomHash = location.hash.substring(1);
els.roomId.textContent = roomHash;

// TODO: Replace with your own channel ID (currently demo)
const drone = new ScaleDrone('yiS12Ts5RdNhebyM');
// Room name needs to be prefixed with 'observable-'
const roomName = 'observable-' + roomHash;
const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};
let room; let pc; let localStream;

function setStatus(text, cls) {
  els.connStatus.textContent = text;
  els.connStatus.classList.remove('ok', 'warn', 'err');
  if (cls) els.connStatus.classList.add(cls);
}

function onSuccess() {}
function onError(error) { console.error(error); setStatus('error', 'err'); }

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
    const sender = pc.getSenders().find(s => s.track && s.track.kind === newTrack.kind);
    if (sender) await sender.replaceTrack(newTrack);
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
  try { pc?.close(); } catch {}
  localStream?.getTracks().forEach(t => t.stop());
  if (els.localVideo) els.localVideo.srcObject = null;
  if (els.remoteVideo) els.remoteVideo.srcObject = null;
  setStatus('ended', 'warn');
});

drone.on('open', error => {
  if (error) { return onError(error); }
  room = drone.subscribe(roomName);
  room.on('open', error => { if (error) onError(error); });
  // We're connected to the room and received an array of 'members'
  room.on('members', members => {
    console.log('MEMBERS', members);
    const isOfferer = members.length === 2;
    startWebRTC(isOfferer);
  });
});

// Send signaling data via Scaledrone
function sendMessage(message) {
  drone.publish({ room: roomName, message });
}

function startWebRTC(isOfferer) {
  pc = new RTCPeerConnection(configuration);

  pc.addEventListener('connectionstatechange', () => {
    const s = pc.connectionState;
    if (s === 'connected') setStatus('connected', 'ok');
    else if (s === 'failed') setStatus('failed', 'err');
    else setStatus(s, s === 'connecting' ? 'warn' : undefined);
  });

  // ICE candidate to other peer
  pc.onicecandidate = event => {
    if (event.candidate) sendMessage({ 'candidate': event.candidate });
  };

  // If user is offerer let the 'negotiationneeded' event create the offer
  if (isOfferer) {
    pc.onnegotiationneeded = () => {
      pc.createOffer().then(localDescCreated).catch(onError);
    }
  }

  // Remote stream
  pc.ontrack = event => {
    const stream = event.streams[0];
    if (!els.remoteVideo.srcObject || els.remoteVideo.srcObject.id !== stream.id) {
      els.remoteVideo.srcObject = stream;
    }
  };

  // Get user media with default devices first
  navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(async stream => {
    localStream = stream;
    els.localVideo.srcObject = stream;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    await listDevices();
  }, onError);

  // Listen to signaling data from Scaledrone
  room.on('data', (message, client) => {
    if (client.id === drone.clientId) return; // ignore our own
    if (message.sdp) {
      pc.setRemoteDescription(new RTCSessionDescription(message.sdp))
        .then(() => {
          if (pc.remoteDescription && pc.remoteDescription.type === 'offer') {
            return pc.createAnswer().then(localDescCreated);
          }
        })
        .catch(onError);
    } else if (message.candidate) {
      pc.addIceCandidate(new RTCIceCandidate(message.candidate), onSuccess, onError);
    }
  });
}

function localDescCreated(desc) {
  return pc.setLocalDescription(desc)
    .then(() => sendMessage({ 'sdp': pc.localDescription }))
    .catch(onError);
}
