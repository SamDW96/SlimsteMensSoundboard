// --- 1. TOAST NOTIFICATION SYSTEM ---
function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'info';
    if (type === 'success') icon = 'check_circle';
    if (type === 'error') icon = 'error';

    toast.innerHTML = `<span class="material-symbols-rounded" style="font-size:20px">${icon}</span> ${msg}`;
    container.appendChild(toast);

    requestAnimationFrame(() => { toast.classList.add('show'); });
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- 2. REMOTE LOGIC (Fixed Refresh & Double Toast) ---
let peer = null, conn = null, isHost = false, heartbeatInterval = null;
let isDisconnecting = false; // Flag om dubbele toasts te voorkomen

const modal = document.getElementById('remote-modal');
const remoteIcon = document.getElementById('remote-icon');

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (conn && conn.open) {
            conn.send({ action: 'ping' });
        }
    }, 2000);
}

function stopHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = null;
}

function openModal() {
    modal.classList.remove('hidden');
    const menu = document.getElementById('remote-menu'), connectedMenu = document.getElementById('connected-menu'), cancelBtn = document.getElementById('btn-main-cancel');
    document.getElementById('host-screen').classList.add('hidden');
    document.getElementById('join-screen').classList.add('hidden');

    if (peer && !peer.destroyed && conn && conn.open) {
        menu.classList.add('hidden'); connectedMenu.classList.remove('hidden'); cancelBtn.classList.add('hidden');
    } else {
        menu.classList.remove('hidden'); connectedMenu.classList.add('hidden'); cancelBtn.classList.remove('hidden');
    }
}
function closeModal() { modal.classList.add('hidden'); }
function cancelAndClose() { if (peer && (!conn || !conn.open)) disconnectRemote(); closeModal(); }

function showRemoteMenu() {
    // FIX: Als we teruggaan naar menu, moet de interne status ook gereset worden
    if (peer && (!conn || !conn.open)) disconnectRemote();
    document.getElementById('host-screen').classList.add('hidden');
    document.getElementById('join-screen').classList.add('hidden');
    document.getElementById('connected-menu').classList.add('hidden');
    document.getElementById('remote-menu').classList.remove('hidden');
    document.getElementById('btn-main-cancel').classList.remove('hidden');
}

// FIX: Voorkom dubbele toasts en reset UI correct
function disconnectRemote() {
    if (isDisconnecting) return;
    isDisconnecting = true;

    stopHeartbeat();
    if (conn) conn.close();
    if (peer) peer.destroy();

    peer = null; conn = null; isHost = false;

    remoteIcon.innerText = "cast";
    remoteIcon.classList.remove('remote-active');

    if (!modal.classList.contains('hidden')) showRemoteMenu();
    showToast("Verbinding verbroken", "info");

    setTimeout(() => { isDisconnecting = false; }, 500);
}

// FIX: The Polite Goodbye (Bij refresh sturen we een 'closing' bericht)
window.addEventListener('beforeunload', () => {
    if (conn && conn.open) {
        conn.send({ action: 'closing' });
    }
});

function setupHost() {
    document.getElementById('remote-menu').classList.add('hidden');
    document.getElementById('host-screen').classList.remove('hidden');
    document.getElementById('btn-main-cancel').classList.add('hidden');
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    document.getElementById('host-code-display').innerText = code;
    document.getElementById('host-status').innerText = "Wachten op verbinding...";

    if (peer) peer.destroy();
    peer = new Peer("sm-" + code);
    peer.on('open', (id) => {
        remoteIcon.innerText = "cast";
        isHost = true; // Nu zijn we host
    });
    peer.on('connection', (connection) => {
        conn = connection;
        document.getElementById('host-status').innerText = "✅ Verbonden!";
        remoteIcon.innerText = "cast_connected"; remoteIcon.classList.add('remote-active');
        closeModal(); startHeartbeat();
        showToast("Client verbonden!", "success");
        setTimeout(() => sendRemote('volume', globalVolume), 500);

        // Luister naar data van client (bijv. de 'closing' message)
        conn.on('data', (data) => handleRemoteCommand(data));
        conn.on('close', () => disconnectRemote());
    });
    peer.on('error', (err) => showToast("Fout: " + err, "error"));
    peer.on('disconnected', () => disconnectRemote());
}

function setupJoin() {
    document.getElementById('remote-menu').classList.add('hidden');
    document.getElementById('join-screen').classList.remove('hidden');
    document.getElementById('btn-main-cancel').classList.add('hidden');
}

function connectToHost() {
    const inputCode = document.getElementById('join-code-input').value.trim().toUpperCase();
    if (inputCode.length < 4) return showToast("Code te kort", "error");
    if (peer) peer.destroy();
    peer = new Peer();
    peer.on('open', () => {
        conn = peer.connect("sm-" + inputCode);
        conn.on('open', () => {
            closeModal(); startHeartbeat();
            document.getElementById('client-start-screen').classList.remove('hidden');
            showToast("Verbonden met Host", "success");
        });
        conn.on('data', (data) => handleRemoteCommand(data));
        conn.on('close', () => disconnectRemote());
    });
    peer.on('error', () => showToast("Kan host niet vinden", "error"));
}

function activateClientAudio() {
    document.getElementById('client-start-screen').classList.add('hidden');
    remoteIcon.innerText = "cast_connected"; remoteIcon.classList.add('remote-active');
    activateWakeLock();
}

function sendRemote(action, payload) {
    if (isHost && conn) conn.send({ action: action, payload: payload });
}

function handleRemoteCommand(data) {
    if (data.action === 'ping') return;

    // FIX: Als de ander ververst, ontvangen we dit bericht
    if (data.action === 'closing') {
        disconnectRemote();
        return;
    }

    if (data.action === 'playSingle') {
        stopAllMainTracks(true);
        playSingle(audioFiles[data.payload.key], els[data.payload.key], data.payload.key === 'leader' ? els.progLeader : null, true);
    }
    else if (data.action === 'stopAll') stopAllMainTracks(true);
    else if (data.action === 'clockStart') startClockLogic(true);
    else if (data.action === 'clockStop') stopClockLogic(true);
    else if (data.action === 'sfx') playSFX(sfxPaths[data.payload], true);
    else if (data.action === 'autoStopSet') {
        autoStopDuration = data.payload;
        els.autoStopBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.time) === autoStopDuration));
    }
    else if (data.action === 'autoStopClear') {
        autoStopDuration = null; els.autoStopBtns.forEach(b => b.classList.remove('active'));
    }
    else if (data.action === 'volume') setGlobalVolume(data.payload, true);
}

// --- 3. CORE LOGIC ---
let wakeLock = null;
async function activateWakeLock() {
    if ('wakeLock' in navigator) {
        try { if (!wakeLock) wakeLock = await navigator.wakeLock.request('screen'); }
        catch (err) { console.error(err); }
    }
}
document.addEventListener('visibilitychange', async () => { if (!wakeLock && document.visibilityState === 'visible') activateWakeLock(); });

const audioFiles = {
    leader: new Audio('audio/leader.mp3'),
    bumper: new Audio('audio/bumper.mp3'),
    clock: new Audio('audio/klok.mp3'),
    stopklok: new Audio('audio/stopklok.mp3'),
    finale: new Audio('audio/finale.mp3')
};
Object.values(audioFiles).forEach(audio => { audio.preload = 'auto'; audio.loop = false; });
audioFiles.clock.loop = true;

const sfxPaths = { juist: 'audio/juist.mp3', fout: 'audio/fout.mp3' };
const sfxCache = {};
Object.keys(sfxPaths).forEach(key => { sfxCache[key] = new Audio(sfxPaths[key]); sfxCache[key].preload = 'auto'; });

let globalVolume = 1.0, lastVolume = 1.0;
const els = {
    leader: document.getElementById('btn-leader'),
    progLeader: document.getElementById('progress-leader'),
    bumper: document.getElementById('btn-bumper'),
    clockPanel: document.getElementById('panel-clock'),
    clockTarget: document.getElementById('clock-click-target'),
    clockTimer: document.getElementById('clock-timer'),
    autoStopWrapper: document.getElementById('auto-stop-wrapper'),
    autoStopBtns: document.querySelectorAll('.auto-stop-btn'),
    clockActions: document.getElementById('clock-actions'),
    juist: document.getElementById('btn-juist'),
    fout: document.getElementById('btn-fout'),
    stop: document.getElementById('btn-stop'),
    finale: document.getElementById('btn-finale'),
    themeBtn: document.getElementById('btn-theme-toggle'),
    themeIcon: document.getElementById('theme-icon'),
    volumeSlider: document.getElementById('volume-slider'),
    volumeIcon: document.getElementById('volume-icon'),
    muteBtn: document.getElementById('btn-mute-toggle')
};

function updateVolumeIcon(vol) {
    els.volumeIcon.innerText = vol === 0 ? 'volume_off' : (vol < 0.5 ? 'volume_down' : 'volume_up');
}
function setGlobalVolume(vol, fromRemote = false) {
    globalVolume = parseFloat(vol);
    els.volumeSlider.value = globalVolume;
    Object.values(audioFiles).forEach(audio => audio.volume = globalVolume);
    updateVolumeIcon(globalVolume);
    if (!fromRemote) sendRemote('volume', globalVolume);
}
els.volumeSlider.addEventListener('input', (e) => setGlobalVolume(e.target.value));
els.muteBtn.addEventListener('click', () => {
    if (globalVolume > 0) { lastVolume = globalVolume; setGlobalVolume(0); } else { setGlobalVolume(lastVolume || 1.0); }
});

let currentThemeMode = 'auto';
function updateTheme() {
    const root = document.documentElement; root.removeAttribute('data-theme');
    if (currentThemeMode === 'auto') {
        els.themeIcon.innerText = "brightness_auto";
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) root.setAttribute('data-theme', 'light');
    } else if (currentThemeMode === 'light') { els.themeIcon.innerText = "light_mode"; root.setAttribute('data-theme', 'light'); }
    else { els.themeIcon.innerText = "dark_mode"; }
}
els.themeBtn.addEventListener('click', () => {
    currentThemeMode = currentThemeMode === 'auto' ? 'light' : (currentThemeMode === 'light' ? 'dark' : 'auto');
    updateTheme();
});
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', updateTheme);
updateTheme();

// --- PLAYBACK ---
function playSingle(audioObj, btnElement, progElement, isRemote = false, skipBroadcast = false) {
    activateWakeLock();
    audioObj.volume = globalVolume; audioObj.currentTime = 0;
    audioObj.play().catch(e => console.error(e));
    if (btnElement) btnElement.classList.add('playing');
    if (progElement) progElement.style.width = '0%';
    if (!isRemote && isHost && !skipBroadcast) {
        let key = Object.keys(audioFiles).find(k => audioFiles[k] === audioObj);
        if (key) sendRemote('playSingle', { key: key });
    }
}
function stopSingle(audioObj, btnElement, progElement) {
    audioObj.pause(); audioObj.currentTime = 0;
    if (btnElement) btnElement.classList.remove('playing');
    if (progElement) progElement.style.width = '0%';
}
function stopAllMainTracks(isRemote = false) {
    stopSingle(audioFiles.leader, els.leader, els.progLeader);
    stopClockLogic(isRemote);
    stopSingle(audioFiles.bumper, els.bumper);
    stopSingle(audioFiles.finale, els.finale);
    stopSingle(audioFiles.stopklok, els.stop);
    if (!isRemote) sendRemote('stopAll', null);
}
function playSFX(path, isRemote = false) {
    activateWakeLock();
    const sfx = new Audio(path); sfx.preload = 'auto'; sfx.volume = globalVolume; sfx.play();
    if (!isRemote && isHost) {
        let key = Object.keys(sfxPaths).find(k => sfxPaths[k] === path);
        if (key) sendRemote('sfx', key);
    }
}

els.leader.addEventListener('click', () => {
    if (!audioFiles.leader.paused) { stopSingle(audioFiles.leader, els.leader, els.progLeader); sendRemote('stopAll', null); }
    else { stopAllMainTracks(); playSingle(audioFiles.leader, els.leader, els.progLeader); }
});
if (els.progLeader) {
    audioFiles.leader.addEventListener('timeupdate', () => { if (audioFiles.leader.duration) els.progLeader.style.width = (audioFiles.leader.currentTime / audioFiles.leader.duration) * 100 + '%'; });
    audioFiles.leader.addEventListener('ended', () => {
        els.progLeader.style.width = '0%'; els.leader.classList.remove('playing');
        playSingle(audioFiles.bumper, els.bumper, null, false, true);
    });
}
els.bumper.addEventListener('click', () => { stopAllMainTracks(); playSingle(audioFiles.bumper, els.bumper); });
audioFiles.bumper.addEventListener('ended', () => els.bumper.classList.remove('playing'));
els.finale.addEventListener('click', () => { stopAllMainTracks(); playSingle(audioFiles.finale, els.finale); });
audioFiles.finale.addEventListener('ended', () => els.finale.classList.remove('playing'));

els.clockTarget.addEventListener('click', () => { if (!audioFiles.clock.paused) stopClockLogic(); else startClockLogic(); });
els.juist.addEventListener('click', (e) => { e.stopPropagation(); playSFX(sfxPaths.juist); });
els.fout.addEventListener('click', (e) => { e.stopPropagation(); playSFX(sfxPaths.fout); });
els.stop.addEventListener('click', (e) => {
    e.stopPropagation(); stopClockLogic(); audioFiles.stopklok.volume = globalVolume; playSingle(audioFiles.stopklok, els.stop);
});
audioFiles.stopklok.addEventListener('ended', () => els.stop.classList.remove('playing'));

els.autoStopBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation(); activateWakeLock();
        const time = parseInt(btn.dataset.time);
        if (autoStopDuration === time) { autoStopDuration = null; btn.classList.remove('active'); sendRemote('autoStopClear', null); }
        else { autoStopDuration = time; els.autoStopBtns.forEach(b => b.classList.remove('active')); btn.classList.add('active'); sendRemote('autoStopSet', time); }
    });
});

let clockInterval = null, clockStartTime = null, autoStopDuration = null;
function startClockLogic(isRemote = false) {
    if (!isRemote) stopAllMainTracks(); else stopAllMainTracks(true);
    playSingle(audioFiles.clock, els.clockPanel, null, isRemote);
    els.clockTimer.style.display = 'block'; els.autoStopWrapper.style.display = 'flex'; els.clockActions.style.display = 'grid';
    clockStartTime = Date.now(); els.clockTimer.innerText = "00:00";
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
        const elapsedSeconds = (Date.now() - clockStartTime) / 1000;
        const minutes = Math.floor(elapsedSeconds / 60); const seconds = Math.floor(elapsedSeconds % 60);
        els.clockTimer.innerText = (minutes < 10 ? "0" + minutes : minutes) + ":" + (seconds < 10 ? "0" + seconds : seconds);
        if (autoStopDuration !== null && elapsedSeconds >= autoStopDuration) performAutoStop();
    }, 100);
    if (!isRemote) sendRemote('clockStart', null);
}
function stopClockLogic(isRemote = false) {
    stopSingle(audioFiles.clock, els.clockPanel);
    if (clockInterval) clearInterval(clockInterval); clockInterval = null;
    els.clockTimer.style.display = 'none'; els.autoStopWrapper.style.display = 'none'; els.clockActions.style.display = 'none'; els.clockTimer.innerText = "00:00";
    if (!isRemote) sendRemote('clockStop', null);
}
function performAutoStop() {
    stopClockLogic(true); audioFiles.stopklok.volume = globalVolume;
    const sfx = audioFiles.stopklok; sfx.currentTime = 0; sfx.play();
    els.stop.classList.add('playing'); setTimeout(() => els.stop.classList.remove('playing'), 500);
}
