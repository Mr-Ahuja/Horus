// Two-person WebRTC via ScaleDrone signaling with landing and duo UI
var starsRAF = 0;

// Elements
const els = {
  roomId: document.getElementById('roomId'),
  roomTitle: document.getElementById('roomTitle'),
  connStatus: document.getElementById('connStatus'),
  copyLinkBtn: document.getElementById('copyLinkBtn'),
  toggleMicBtn: document.getElementById('toggleMicBtn'),
  toggleCamBtn: document.getElementById('toggleCamBtn'),
  hangupBtn: document.getElementById('hangupBtn'),
  audioIn: document.getElementById('audioIn'),
  videoIn: document.getElementById('videoIn'),
  localVideo: document.getElementById('localVideo'),
  remoteVideo: document.getElementById('remoteVideo'),
  remoteAudio: document.getElementById('remoteAudio'),
  speakerBtn: document.getElementById('speakerBtn'),
};

const landing = document.getElementById('landing');
const startRoomBtn = document.getElementById('startRoomBtn');
const roomTitleInput = document.getElementById('roomTitleInput');
const roomInput = document.getElementById('roomInput');
const goBtn = document.getElementById('goBtn');

// State
let roomHash = location.hash.substring(1);
let roomName = roomHash ? 'observable-' + roomHash : null;
let drone = null; let room = null; let pc = null; let localStream = null; let ended = false;
let roomTitle = '';
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let pendingCandidates = [];
let outputs = []; let speakerMode = true;

// Helpers
function setStatus(text, cls){ els.connStatus.textContent = text; els.connStatus.classList.remove('ok','warn','err'); if(cls) els.connStatus.classList.add(cls); }
function onError(e){ console.error(e); setStatus('error','err'); }
function publish(msg){ if(room && drone) drone.publish({ room: roomName, message: msg }); }

// Landing visibility: keep landing even for shared links; prefill input
if (roomHash) { els.roomId.textContent = roomHash; if (roomInput) roomInput.value = roomHash; }
landing?.classList.remove('hidden');

// Copy link
els.copyLinkBtn?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); els.copyLinkBtn.textContent = 'Link Copied'; setTimeout(()=>els.copyLinkBtn.textContent='Copy Link',1500); }
  catch { prompt('Copy this link', location.href); }
});

// Start/join actions (user gesture => audio works)
startRoomBtn?.addEventListener('click', () => {
  roomTitle = (roomTitleInput?.value || '').trim(); if (roomTitle) els.roomTitle.textContent = roomTitle;
  roomHash = Math.floor(Math.random() * 0xFFFFFF).toString(16);
  location.hash = roomHash; begin();
});

goBtn?.addEventListener('click', () => {
  roomTitle = (roomTitleInput?.value || '').trim(); if (roomTitle) els.roomTitle.textContent = roomTitle;
  const code = (roomInput?.value || '').trim(); if(!code) return; location.hash = code.replace(/^#/, ''); begin();
});

// Media controls (icons only)
els.toggleMicBtn?.addEventListener('click', () => { if(!localStream) return; const t = localStream.getAudioTracks()[0]; if(!t) return; t.enabled = !t.enabled; els.toggleMicBtn.setAttribute('aria-pressed', String(!t.enabled)); const icon=els.toggleMicBtn.querySelector('span.material-icons'); if(icon) icon.textContent = t.enabled ? 'mic' : 'mic_off'; });
els.toggleCamBtn?.addEventListener('click', () => { if(!localStream) return; const t = localStream.getVideoTracks()[0]; if(!t) return; t.enabled = !t.enabled; els.toggleCamBtn.setAttribute('aria-pressed', String(!t.enabled)); const icon=els.toggleCamBtn.querySelector('span.material-icons'); if(icon) icon.textContent = t.enabled ? 'videocam' : 'videocam_off'; });
els.hangupBtn?.addEventListener('click', () => { try{ pc?.close(); }catch{} localStream?.getTracks().forEach(t=>t.stop()); els.localVideo.srcObject=null; els.remoteVideo.srcObject=null; if(!ended){ ended=true; publish({ endAll:true }); setTimeout(()=>{ location.hash=''; landing?.classList.remove('hidden'); startStars(true); },300); } });

// Speaker toggle (hide on unsupported)
if (!('setSinkId' in HTMLMediaElement.prototype)) { if (els.speakerBtn) els.speakerBtn.style.display = 'none'; }
function updateSpeakerIcon(){ const ic = els.speakerBtn?.querySelector('span.material-icons'); if(ic) ic.textContent = speakerMode ? 'speaker' : 'headset'; }
els.speakerBtn?.addEventListener('click', () => { speakerMode = !speakerMode; updateSpeakerIcon(); try{ routeToSpeaker(); }catch{} });

// Devices
els.audioIn?.addEventListener('change', async (e)=>{ const id=e.target.value; if(!localStream) return; try{ const s=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:id}}}); const nt=s.getAudioTracks()[0]; const sender=pc?.getSenders().find(x=>x.track && x.track.kind==='audio'); if(sender) sender.replaceTrack(nt); localStream.getAudioTracks().forEach(t=>t.stop()); localStream.removeTrack(localStream.getAudioTracks()[0]); localStream.addTrack(nt);}catch(err){ onError(err); }});
els.videoIn?.addEventListener('change', async (e)=>{ const id=e.target.value; if(!localStream) return; try{ const s=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:id}}}); const nt=s.getVideoTracks()[0]; const sender=pc?.getSenders().find(x=>x.track && x.track.kind==='video'); if(sender) sender.replaceTrack(nt); localStream.getVideoTracks().forEach(t=>t.stop()); localStream.removeTrack(localStream.getVideoTracks()[0]); localStream.addTrack(nt);}catch(err){ onError(err);} });

async function ensureLocal(){ if(localStream) return; const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true }); localStream = stream; els.localVideo.srcObject = stream; await listDevices(); }
async function listDevices(){ try{ const dev=await navigator.mediaDevices.enumerateDevices(); els.audioIn.innerHTML=dev.filter(d=>d.kind==='audioinput').map(d=>`<option value="${d.deviceId}">${d.label||'Mic'}</option>`).join(''); els.videoIn.innerHTML=dev.filter(d=>d.kind==='videoinput').map(d=>`<option value="${d.deviceId}">${d.label||'Camera'}</option>`).join(''); }catch(e){ console.warn('enumerateDevices failed',e);} }

function begin(){ landing?.classList.add('hidden'); startStars(false); if(!roomHash) roomHash=location.hash.substring(1); els.roomId.textContent=roomHash; roomName='observable-'+roomHash; drone = new ScaleDrone('yiS12Ts5RdNhebyM'); attach(); routeToSpeaker(); }

function attach(){
  drone.on('open', async err => {
    if(err) return onError(err);
    room = drone.subscribe(roomName);
    room.on('open', async e => { if(e) onError(e); else { setStatus('connected to room','warn'); try{ await ensureLocal(); }catch(e2){ onError(e2); } } });
    room.on('members', members => { if(members.length>2){ setStatus('room full (2 only)','err'); try{ drone.close(); }catch{} return; } const isOfferer = members.length===2; startWebRTC(isOfferer); });
    room.on('data', (message, client) => { if(client.id===drone.clientId) return; if(message.endAll){ els.hangupBtn?.click(); return; } if(!pc) return; if(message.sdp){ const desc=new RTCSessionDescription(message.sdp); pc.setRemoteDescription(desc).then(()=>{ if(desc.type==='offer'){ pc.createAnswer().then(localDescCreated).catch(onError); } flushCandidates(); }).catch(onError); } else if(message.candidate){ handleRemoteCandidate(message.candidate); } });
  });
}

function startWebRTC(isOfferer){ if(pc) return; pc = new RTCPeerConnection(configuration); pendingCandidates = [];
  pc.onconnectionstatechange = () => { const s=pc.connectionState; if(s==='connected') setStatus('connected','ok'); else if(s==='failed') setStatus('failed','err'); else setStatus(s, s==='connecting'?'warn':undefined); };
  pc.onicecandidate = ev => { if(ev.candidate) publish({ candidate: ev.candidate }); };
  pc.ontrack = ev => {
    const stream = ev.streams[0];
    // attach video
    if(!els.remoteVideo.srcObject || els.remoteVideo.srcObject.id!==stream.id){
      els.remoteVideo.srcObject = stream; els.remoteVideo.play?.().catch(()=>{});
    }
    // attach audio separately
    try {
      const aStream = new MediaStream(stream.getAudioTracks());
      els.remoteAudio.srcObject = aStream; els.remoteAudio.play?.().catch(()=>{});
      routeToSpeaker();
    } catch {}
  };
  if(localStream){ localStream.getTracks().forEach(t=>pc.addTrack(t, localStream)); }
  else { navigator.mediaDevices.getUserMedia({video:true,audio:true}).then(stream=>{ localStream=stream; els.localVideo.srcObject=stream; stream.getTracks().forEach(t=>pc.addTrack(t,stream)); }).catch(onError); }
  if(isOfferer){ pc.onnegotiationneeded = () => { pc.createOffer().then(localDescCreated).catch(onError); } }
}

function localDescCreated(desc){ pc.setLocalDescription(desc).then(()=> publish({ sdp: pc.localDescription })).catch(onError); }
function handleRemoteCandidate(c){ if(pc.remoteDescription) pc.addIceCandidate(new RTCIceCandidate(c)).catch(onError); else pendingCandidates.push(c); }
function flushCandidates(){ while(pendingCandidates.length){ const c=pendingCandidates.shift(); pc.addIceCandidate(new RTCIceCandidate(c)).catch(onError); } }
function routeToSpeaker(){
  try {
    const sinkTarget = els.remoteAudio || els.remoteVideo;
    if (typeof sinkTarget.setSinkId === 'function') {
      navigator.mediaDevices.enumerateDevices().then(list => {
        const outs = list.filter(d => d.kind === 'audiooutput');
        const sp = outs.find(o => /speaker/i.test(o.label));
        const id = sp ? sp.deviceId : (outs[0]?.deviceId || 'default');
        return sinkTarget.setSinkId(id);
      }).catch(()=>{});
    }
  } catch(e) {}
}

// Celestial landing animation with persistent lines
function startStars(enable){ const cnv=document.getElementById('stars'); if(!cnv) return; const ctx=cnv.getContext('2d'); let w=0,h=0,particles=[],lines=[]; function resize(){ const dpr=Math.min(2,window.devicePixelRatio||1); w=cnv.clientWidth; h=cnv.clientHeight; cnv.width=Math.floor(w*dpr); cnv.height=Math.floor(h*dpr); ctx.setTransform(dpr,0,0,dpr,0,0);} function init(){ const base=(w*h); const density=(Math.min(w,h)<520)?30000:22000; const count=Math.max(50,Math.floor(base/density)); particles=new Array(count).fill(0).map(()=>({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-0.5)*0.12,vy:(Math.random()-0.5)*0.12,r:Math.random()*1.2+0.3})); lines=[]; } function step(){ ctx.clearRect(0,0,w,h); ctx.fillStyle='#9fb3cc'; for(const p of particles){ p.x+=p.vx; p.y+=p.vy; if(p.x<0||p.x>w) p.vx*=-1; if(p.y<0||p.y>h) p.vy*=-1; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); } ctx.strokeStyle='#264567'; ctx.globalAlpha=0.6; ctx.lineWidth=0.5; lines = lines.filter(L=>{ ctx.beginPath(); ctx.moveTo(L.ax,L.ay); ctx.lineTo(L.bx,L.by); ctx.stroke(); L.ttl-=1; return L.ttl>0; }); if(Math.random()<0.02){ const a=particles[(Math.random()*particles.length)|0], b=particles[(Math.random()*particles.length)|0]; const dx=a.x-b.x, dy=a.y-b.y; const d=dx*dx+dy*dy; if(d<120*120){ lines.push({ax:a.x,ay:a.y,bx:b.x,by:b.y,ttl:40+((Math.random()*40)|0)}); } } ctx.globalAlpha=1; starsRAF=requestAnimationFrame(step);} function stop(){ if(starsRAF) cancelAnimationFrame(starsRAF); starsRAF=0;} if(enable){ resize(); init(); step(); window.addEventListener('resize', ()=>{ resize(); init(); }); } else { stop(); } }
