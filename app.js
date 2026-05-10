// Konfigūracija ir būsena
const NOTES = [
    { name: 'C', midi: 60, color: 'var(--note-c)', staffOffset: 6 }, // Ledger line below
    { name: 'D', midi: 62, color: 'var(--note-d)', staffOffset: 5 }, // Space below
    { name: 'E', midi: 64, color: 'var(--note-e)', staffOffset: 4 }, // 1st line (bottom)
    { name: 'F', midi: 65, color: 'var(--note-f)', staffOffset: 3 }, // 1st space
    { name: 'G', midi: 67, color: 'var(--note-g)', staffOffset: 2 }, // 2nd line
    { name: 'A', midi: 69, color: 'var(--note-a)', staffOffset: 1 }, // 2nd space
    { name: 'B', midi: 71, color: 'var(--note-b)', staffOffset: 0 }  // 3rd line (middle)
];

let selectedNotes = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']); // Default visos
let activeNotes = [];
let score = 0;
let combo = 0;
let isGameRunning = false;
let gameSpeed = 4;
let lastTime = 0;
let spawnTimer = 0;
let timeLeft = 180; // 3 minutes
let wakeLock = null;
let handMode = 'right'; // 'right' or 'both'

// Highscore logic
function getHighscoreKey() {
    return `piano_highscore_${handMode}_${selectedNotes.size}`;
}

function updateHighscoreDisplay() {
    const key = getHighscoreKey();
    const highscore = localStorage.getItem(key) || 0;
    document.getElementById('highscore-notes-count').textContent = selectedNotes.size;
    document.getElementById('highscore-display').textContent = highscore;
}

// Wake Lock API
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => { wakeLock = null; });
    }
}

// Audio Synth
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playNoteSound(midiNote) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 1);
}

// UI Elementai
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const midiStatus = document.getElementById('midi-status');
const notesSelector = document.getElementById('notes-selector');
const speedSlider = document.getElementById('speed-slider');
const scoreDisplay = document.getElementById('score');
const comboDisplay = document.getElementById('combo');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Inicializacija
function initUI() {
    // Sukurti natų mygtukus
    NOTES.forEach(note => {
        const btn = document.createElement('button');
        btn.className = 'note-toggle active';
        btn.textContent = note.name;
        btn.style.borderColor = note.color;
        
        btn.addEventListener('click', () => {
            if (selectedNotes.has(note.name)) {
                if (selectedNotes.size > 1) { // Neleisti išjungti visų
                    selectedNotes.delete(note.name);
                    btn.classList.remove('active');
                }
            } else {
                selectedNotes.add(note.name);
                btn.classList.add('active');
            }
            updateHighscoreDisplay();
        });
        notesSelector.appendChild(btn);
    });

    // Event listeners
    startBtn.addEventListener('click', startGame);
    stopBtn.addEventListener('click', stopGame);
    speedSlider.addEventListener('input', (e) => {
        gameSpeed = parseInt(e.target.value);
    });

    const handModeSelect = document.getElementById('hand-mode-select');
    if (handModeSelect) {
        handModeSelect.addEventListener('change', (e) => {
            handMode = e.target.value;
            updateHighscoreDisplay();
        });
    }

    // Resize canvas
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    updateHighscoreDisplay();
}

function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
}

// Web MIDI
function initMIDI() {
    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess({ sysex: false })
            .then(onMIDISuccess, onMIDIFailure);
    } else {
        midiStatus.textContent = 'Web MIDI API nepalaikomas naršyklėje.';
        midiStatus.className = 'status-box error';
    }
}

function onMIDISuccess(midiAccess) {
    midiStatus.textContent = 'Laukiama MIDI įrenginio...';
    
    const inputs = midiAccess.inputs.values();
    let deviceFound = false;

    for (let input = inputs.next(); input && !input.done; input = inputs.next()) {
        input.value.onmidimessage = onMIDIMessage;
        deviceFound = true;
        midiStatus.textContent = `Prisijungta prie: ${input.value.name} ✅`;
        midiStatus.className = 'status-box connected';
        startBtn.disabled = false;
    }

    if (!deviceFound) {
        midiStatus.textContent = 'Nerastas MIDI įrenginys. Susiekite pianiną.';
        startBtn.disabled = false; // Leidžiame pradėti net ir be MIDI (pvz., testavimui)
    }

    midiAccess.onstatechange = (e) => {
        if (e.port.type === 'input' && e.port.state === 'connected') {
            e.port.onmidimessage = onMIDIMessage;
            midiStatus.textContent = `Prisijungta prie: ${e.port.name} ✅`;
            midiStatus.className = 'status-box connected';
            startBtn.disabled = false;
        }
    };
}

function onMIDIFailure() {
    midiStatus.textContent = 'Nepavyko pasiekti MIDI įrenginių.';
    midiStatus.className = 'status-box error';
    startBtn.disabled = false; // Leidžiame testuoti varikliuką
}

function onMIDIMessage(message) {
    const command = message.data[0];
    const note = message.data[1];
    const velocity = (message.data.length > 2) ? message.data[2] : 0;

    // Note On (dažnai velocity = 0 reiškia Note Off)
    if (command >= 144 && command <= 159 && velocity > 0) {
        handleKeyPress(note);
        playNoteSound(note);
    }
}

// Game Logic
function startGame() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    setupScreen.classList.remove('active');
    gameScreen.classList.add('active');
    
    resizeCanvas();
    requestWakeLock();
    
    activeNotes = [];
    score = 0;
    combo = 0;
    timeLeft = 180;
    updateScore();
    updateTimerDisplay();
    
    isGameRunning = true;
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function stopGame() {
    isGameRunning = false;
    releaseWakeLock();
    
    // Save highscore
    const key = getHighscoreKey();
    const currentHighscore = parseInt(localStorage.getItem(key)) || 0;
    if (score > currentHighscore) {
        localStorage.setItem(key, score);
        alert(`Žaidimas baigtas! Laikas baigėsi.\nNaujas rekordas su ${selectedNotes.size} natomis: ${score} taškų!`);
    } else {
        alert(`Žaidimas baigtas! Jūsų taškai: ${score}`);
    }
    
    updateHighscoreDisplay();
    
    gameScreen.classList.remove('active');
    setupScreen.classList.add('active');
}

function spawnNote() {
    const available = NOTES.filter(n => selectedNotes.has(n.name));
    if (available.length === 0) return;
    
    const randomNote = available[Math.floor(Math.random() * available.length)];
    const noteIndex = NOTES.findIndex(n => n.name === randomNote.name);
    
    let hand = 'right';
    if (handMode === 'both') {
        hand = Math.random() < 0.5 ? 'left' : 'right';
    }

    let type = 'normal';
    const rand = Math.random();
    if (rand < 0.05) type = 'bomb';
    else if (rand < 0.15) type = 'golden';

    const padding = canvas.width * 0.1;
    let innerWidth = canvas.width - padding * 2;
    let xPos = 0;

    if (handMode === 'both') {
        innerWidth = (canvas.width / 2) - padding * 1.5;
        if (hand === 'left') {
            xPos = padding + (noteIndex / (NOTES.length - 1)) * innerWidth;
        } else {
            xPos = (canvas.width / 2) + padding * 0.5 + (noteIndex / (NOTES.length - 1)) * innerWidth;
        }
    } else {
        xPos = padding + (noteIndex / (NOTES.length - 1)) * innerWidth;
    }

    const actualMidi = hand === 'left' ? randomNote.midi - 12 : randomNote.midi;

    activeNotes.push({
        ...randomNote,
        midi: actualMidi,
        hand: hand,
        type: type,
        x: xPos,
        y: -50,
        marked: false
    });
}

function handleKeyPress(midiNote) {
    if (!isGameRunning) return;

    const hitZoneY = canvas.height * 0.8;
    const hitTolerance = 80;

    // Rasti atitinkamą natą, kuri yra arčiausiai pataikymo zonos
    let hitIndex = -1;
    let minDiff = Infinity;

    for (let i = 0; i < activeNotes.length; i++) {
        const note = activeNotes[i];
        if (!note.marked && note.midi === midiNote) {
            const diff = Math.abs(note.y - hitZoneY);
            if (diff < hitTolerance && diff < minDiff) {
                minDiff = diff;
                hitIndex = i;
            }
        }
    }

    if (hitIndex !== -1) {
        // Pataikėme
        const hitNote = activeNotes[hitIndex];
        hitNote.marked = true;

        if (hitNote.type === 'bomb') {
            score = Math.max(0, score - 50);
            combo = 0;
            createParticles(hitNote.x, hitNote.y, '#ef4444');
        } else if (hitNote.type === 'golden') {
            score += 50 + (combo * 5);
            combo++;
            createParticles(hitNote.x, hitNote.y, '#eab308');
        } else {
            score += 10 + (combo * 2);
            combo++;
            createParticles(hitNote.x, hitNote.y, hitNote.color);
        }
        
        updateScore();
        activeNotes.splice(hitIndex, 1);
    } else {
        // Suklydo arba nuspaudė per anksti/per vėlai
        combo = 0;
        updateScore();
    }
}

function updateScore() {
    scoreDisplay.textContent = score;
    comboDisplay.textContent = combo;
}

function updateTimerDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = Math.floor(timeLeft % 60);
    document.getElementById('timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Visuals
let particles = [];
function createParticles(x, y, color) {
    for (let i = 0; i < 15; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1,
            color
        });
    }
}

function drawStaff(hitZoneY) {
    const lineSpacing = 20;
    const staffTop = hitZoneY - (2 * lineSpacing); // 3rd line is the target for B
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    
    // Nupiešiame 5 linijas (Tradicinė penklinė: E, G, B, D, F, bet čia naudosim paprastą vizualizaciją)
    // Supaprastinta: piešiame 5 linijas. Pataikymo zona Bnatai yra centrinė linija.
    for (let i = -2; i <= 2; i++) {
        const y = hitZoneY + (i * lineSpacing);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
    
    // "Pataikymo zonos" pabrėžimas apačioje ar tiesiog staff fone
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(0, hitZoneY - (3 * lineSpacing), canvas.width, 6 * lineSpacing);
}

function gameLoop(time) {
    if (!isGameRunning) return;

    const deltaTime = time - lastTime;
    lastTime = time;

    // Laikmatis
    const deltaTimeSec = deltaTime / 1000;
    timeLeft -= deltaTimeSec;
    if (timeLeft <= 0) {
        timeLeft = 0;
        updateTimerDisplay();
        stopGame();
        return;
    }
    updateTimerDisplay();

    // Update
    spawnTimer -= deltaTime;
    // Greitis slankiklyje: 1 (lėtas) iki 10 (greitas)
    // Dinaminis greitis pagal likusį laiką
    let spawnRate = 2000 - (gameSpeed * 150); // ms tarp natų
    let speedMultiplier = 1;
    
    if (timeLeft <= 60) {
        speedMultiplier = 1.5;
        spawnRate *= 0.7;
    } else if (timeLeft <= 120) {
        speedMultiplier = 1.2;
        spawnRate *= 0.85;
    }
    
    if (spawnTimer <= 0) {
        spawnNote();
        spawnTimer = spawnRate;
    }

    const hitZoneY = canvas.height * 0.8;
    const baseFallSpeed = (gameSpeed * 0.05) * deltaTime * speedMultiplier;

    // Move notes
    for (let i = activeNotes.length - 1; i >= 0; i--) {
        const speed = activeNotes[i].type === 'golden' ? baseFallSpeed * 1.3 : baseFallSpeed;
        activeNotes[i].y += speed;
        
        // Jei nata praleista
        if (activeNotes[i].y > canvas.height + 50) {
            if (activeNotes[i].type !== 'bomb') {
                combo = 0; // Prarandame combo
                updateScore();
            }
            activeNotes.splice(i, 1);
        }
    }

    // Move particles
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].x += particles[i].vx;
        particles[i].y += particles[i].vy;
        particles[i].life -= 0.05;
        if (particles[i].life <= 0) {
            particles.splice(i, 1);
        }
    }

    // Draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    drawStaff(hitZoneY);

    // Draw notes
    activeNotes.forEach(note => {
        let fillColor = getComputedStyle(document.documentElement).getPropertyValue(note.color.slice(4, -1)).trim() || '#fff';
        let strokeColor = 'transparent';
        let symbol = note.name;
        
        if (note.type === 'golden') {
            fillColor = '#eab308'; // Yellow
            strokeColor = '#fff';
        } else if (note.type === 'bomb') {
            fillColor = '#ef4444'; // Red
            symbol = '💣';
        }

        if (note.hand === 'left' && note.type === 'normal') {
            // Darker inside, bright border for left hand
            strokeColor = fillColor;
            fillColor = 'rgba(255, 255, 255, 0.15)';
        }

        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.arc(note.x, note.y, 25, 0, Math.PI * 2);
        ctx.fill();
        
        if (strokeColor !== 'transparent') {
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 4;
            ctx.stroke();
        }
        
        ctx.fillStyle = (note.hand === 'left' && note.type === 'normal') ? strokeColor : '#fff';
        if (note.type === 'bomb') ctx.fillStyle = '#000';
        ctx.font = note.type === 'bomb' ? 'bold 20px Outfit' : 'bold 24px Outfit';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(symbol, note.x, note.y);
    });

    // Draw particles
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color.includes('var') ? getComputedStyle(document.documentElement).getPropertyValue(p.color.slice(4, -1)) : p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Nupiešti "Keyboard" mygtukus apačioje (testavimui/vizualizacijai)
    const padding = canvas.width * 0.1;
    if (handMode === 'both') {
        const innerWidth = (canvas.width / 2) - padding * 1.5;
        // Left hand markers
        NOTES.forEach((note, index) => {
            const xPos = padding + (index / (NOTES.length - 1)) * innerWidth;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.beginPath();
            ctx.arc(xPos, hitZoneY, 30, 0, Math.PI * 2);
            ctx.stroke();
        });
        // Right hand markers
        NOTES.forEach((note, index) => {
            const xPos = (canvas.width / 2) + padding * 0.5 + (index / (NOTES.length - 1)) * innerWidth;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.arc(xPos, hitZoneY, 30, 0, Math.PI * 2);
            ctx.stroke();
        });
    } else {
        const innerWidth = canvas.width - padding * 2;
        NOTES.forEach((note, index) => {
            const xPos = padding + (index / (NOTES.length - 1)) * innerWidth;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.arc(xPos, hitZoneY, 30, 0, Math.PI * 2);
            ctx.stroke();
        });
    }

    requestAnimationFrame(gameLoop);
}

// Start
initUI();
initMIDI();
