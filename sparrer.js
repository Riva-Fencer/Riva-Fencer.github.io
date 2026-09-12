/**
 * Riva Fencer - Portal 2: Reaction Sparrer Engine (आव्हान)
 * 10-Foot Ambient Vision HUD, Micro-Burst Bout Architecture,
 * Sub-10ms Ballistic Synthesizers, and Eccentric "थांबा!" Balance Halts.
 */
(function () {
    let container = null;
    let audioCtx = null;
    let isRunning = false;
    let isPaused = false;
    let wakeLock = null;

    // Bout Timing Constants (Micro-Burst Architecture)
    const WORK_INTERVAL_MS = 30000;  // 30s High-Intensity Bout
    const REST_INTERVAL_MS = 15000;  // 15s Active Recovery
    const TOTAL_ROUNDS = 4;          // 4 Bouts per Session (~3 min total)

    // Cadence Reaction Windows
    const CADENCE_TIERS = {
        beginner:     { min: 2000, max: 2800, label: 'नवशिक्या (2.5s)' },
        intermediate: { min: 1300, max: 2000, label: 'मध्यम (1.6s)' },
        advanced:     { min: 700,  max: 1300, label: 'वेगवान (1.0s)' }
    };
    let currentTier = 'intermediate';

    // State Variables
    let currentRound = 1;
    let isRestPhase = false;
    let roundTimeRemaining = WORK_INTERVAL_MS;
    let roundTickerInterval = null;
    let cadenceTimeout = null;
    let currentAction = 'idle'; // 'advance', 'retreat', 'freeze', 'lunge'

    // -------------------------------------------------------------
    // 1. HARDWARE-SAFE SUB-10MS WEB AUDIO ENGINE
    // -------------------------------------------------------------
    function ensureAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    // Woodblock ticks for Footwork Cadence (Sub-5ms latency)
    function playWoodblock(freq) {
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const now = audioCtx.currentTime;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.04);
        } catch (e) {}
    }

    // 260Hz Sawtooth Deceleration Brake ("थांबा!" Halt)
    function playBrakeSawtooth() {
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const now = audioCtx.currentTime;

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(260, now);
            // 3ms exponential attack/decay to prevent speaker popping on 1W mono drivers
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.exponentialRampToValueAtTime(0.35, now + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.12);
        } catch (e) {}
    }

    // 1.2 kHz Transient Square Wave for Ballistic Lunge
    function playBallisticAttackStab() {
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const filter = audioCtx.createBiquadFilter();
            const gain = audioCtx.createGain();
            const now = audioCtx.currentTime;

            osc.type = 'square';
            osc.frequency.setValueAtTime(1200, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.09);

            filter.type = 'bandpass';
            filter.frequency.value = 1200;
            filter.Q.value = 2.5;

            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.09);
        } catch (e) {}
    }

    // Celebratory Fanfare at Bout Completion
    function playFanfare() {
        if (!audioCtx) return;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((note, idx) => {
            setTimeout(() => {
                try {
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    const now = audioCtx.currentTime;
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(note, now);
                    gain.gain.setValueAtTime(0.3, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start(now);
                    osc.stop(now + 0.28);
                } catch (e) {}
            }, idx * 110);
        });
    }

    // -------------------------------------------------------------
    // 2. INTERMISSION MARATHI TTS (REST PHASE ONLY)
    // -------------------------------------------------------------
    function speakIntermissionCue(marathiText) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();

        const athlete = JSON.parse(localStorage.getItem('riva_athlete')) || { name: 'रीवा' };
        const customizedText = marathiText.replaceAll('रीवा', athlete.name);

        const utterance = new SpeechSynthesisUtterance(customizedText);
        const voices = window.speechSynthesis.getVoices() || [];
        const mrVoice = voices.find(v => v.lang.toLowerCase().includes('mr')) ||
                        voices.find(v => v.lang.toLowerCase().includes('hi')) || null;
        if (mrVoice) utterance.voice = mrVoice;
        utterance.lang = 'mr-IN';
        utterance.rate = 0.88;
        window.speechSynthesis.speak(utterance);
    }

    // -------------------------------------------------------------
    // 3. 10-FOOT AMBIENT CHROMATIC HUD (DOM INJECTION)
    // -------------------------------------------------------------
    function buildSparrerDOM() {
        container = document.getElementById('sparrerPlaceholderView');
        if (!container) return;

        container.className = 'sparrer-active-stage';
        container.innerHTML = `
            <style>
                .sparrer-active-stage {
                    position: fixed; inset: 0; z-index: 700;
                    display: flex; flex-direction: column;
                    justify-content: space-between; align-items: center;
                    padding: 12px 16px 64px;
                    transition: background-color 0.12s ease;
                    touch-action: manipulation;
                }
                .sparrer-hud-header {
                    width: 100%; max-width: 720px;
                    display: flex; align-items: center; justify-content: space-between;
                }
                .sparrer-hud-pill {
                    background: rgba(15, 23, 42, 0.85);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    padding: 6px 14px; border-radius: 999px;
                    font-size: 13px; font-weight: 800; color: #f8fafc;
                    backdrop-filter: blur(8px);
                }
                .sparrer-center-hero {
                    display: flex; flex-direction: column;
                    align-items: center; justify-content: center;
                    text-align: center; gap: 8px;
                    flex: 1; user-select: none;
                }
                .sparrer-cue-icon {
                    font-size: clamp(68px, 18vw, 120px);
                    line-height: 1; filter: drop-shadow(0 6px 18px rgba(0,0,0,0.5));
                }
                .sparrer-cue-text {
                    font-size: clamp(32px, 8vw, 64px);
                    font-weight: 800; letter-spacing: 0.5px;
                    text-shadow: 0 4px 14px rgba(0,0,0,0.6);
                }
                .sparrer-sub-cue {
                    font-size: clamp(14px, 3.5vw, 20px);
                    font-weight: 700; opacity: 0.9;
                }
                .sparrer-tier-switch {
                    display: flex; gap: 6px; background: rgba(15, 23, 42, 0.8);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    padding: 3px; border-radius: 12px;
                }
                .tier-btn {
                    background: transparent; border: none;
                    color: #94a3b8; font-size: 11.5px; font-weight: 800;
                    padding: 5px 12px; border-radius: 8px; cursor: pointer;
                }
                .tier-btn.active {
                    background: #0284c7; color: #ffffff;
                }
                @media (orientation: landscape) and (max-height: 520px) {
                    .sparrer-active-stage { padding: 6px 16px 10px; }
                    .sparrer-cue-icon { font-size: clamp(48px, 14vh, 84px); }
                    .sparrer-cue-text { font-size: clamp(26px, 7vh, 44px); }
                }
            </style>

            <header class="sparrer-hud-header">
                <div class="sparrer-hud-pill" id="sparrerRoundPill">फेरी १/${TOTAL_ROUNDS}</div>
                
                <div class="sparrer-tier-switch">
                    <button class="tier-btn" id="tierBtnBeg" onclick="window.RivaSparrer.setTier('beginner')">सोपे</button>
                    <button class="tier-btn active" id="tierBtnMed" onclick="window.RivaSparrer.setTier('intermediate')">मध्यम</button>
                    <button class="tier-btn" id="tierBtnAdv" onclick="window.RivaSparrer.setTier('advanced')">जलद</button>
                </div>

                <div class="sparrer-hud-pill" id="sparrerClockPill">३० से.</div>
            </header>

            <main class="sparrer-center-hero" id="sparrerHeroArea" onclick="window.RivaSparrer.triggerHeroTap()">
                <div class="sparrer-cue-icon" id="sparrerIcon">🤺</div>
                <div class="sparrer-cue-text" id="sparrerMainText">ऑन-गार्द!</div>
                <div class="sparrer-sub-cue" id="sparrerSubText">सज्ज राहा...</div>
            </main>
        `;
    }

    // -------------------------------------------------------------
    // 4. AMBIENT CHROMATIC WASHES (10-FOOT LIVING ROOM HUD)
    // -------------------------------------------------------------
    function setAmbientWash(type) {
        if (!container) return;
        const iconEl = document.getElementById('sparrerIcon');
        const textEl = document.getElementById('sparrerMainText');
        const subEl  = document.getElementById('sparrerSubText');

        switch (type) {
            case 'advance': // Emerald Green Wash
                container.style.backgroundColor = '#064e3b';
                iconEl.innerText = '▶▶';
                textEl.innerText = 'पुढे सरका!';
                textEl.style.color = '#4ade80';
                subEl.innerText = 'टाच ➔ चवडा सपाट पाऊल';
                playWoodblock(880);
                break;

            case 'retreat': // Royal Blue Wash
                container.style.backgroundColor = '#0c2d6b';
                iconEl.innerText = '◀◀';
                textEl.innerText = 'मागे व्हा!';
                textEl.style.color = '#38bdf8';
                subEl.innerText = 'मागचा पाय आधी टेकव!';
                playWoodblock(440);
                break;

            case 'freeze': // Intense Amber Pulse ("थांबा!" Brake)
                container.style.backgroundColor = '#78350f';
                iconEl.innerText = '🛑';
                textEl.innerText = 'थांबा!';
                textEl.style.color = '#facc15';
                subEl.innerText = 'हलचाल नको, तोल रोखून धरा!';
                playBrakeSawtooth();
                break;

            case 'lunge': // High-Contrast Electric Cyan/Yellow Flash
                container.style.backgroundColor = '#ca8a04';
                iconEl.innerText = '💥';
                textEl.innerText = 'रॉकेट लंज!';
                textEl.style.color = '#ffffff';
                subEl.innerText = 'हात आधी ➔ ९०° स्फोटक लंज!';
                playBallisticAttackStab();
                break;

            case 'rest': // Restful Low-Stimulus Slate
                container.style.backgroundColor = '#0b1329';
                iconEl.innerText = '🧘';
                textEl.innerText = 'विश्रांती घ्या';
                textEl.style.color = '#94a3b8';
                subEl.innerText = 'श्वास घ्या... पुढील फेरीसाठी सज्ज व्हा';
                break;

            case 'finished': // Victory Celebration
                container.style.backgroundColor = '#064e3b';
                iconEl.innerText = '🏆';
                textEl.innerText = 'शाब्बास रीवा!';
                textEl.style.color = '#facc15';
                subEl.innerText = 'सर्व फेऱ्या यशस्वीरीत्या पूर्ण!';
                playFanfare();
                break;

            default:
                container.style.backgroundColor = '#070a12';
                iconEl.innerText = '🤺';
                textEl.innerText = 'ऑन-गार्द!';
                textEl.style.color = '#f8fafc';
                subEl.innerText = 'सज्ज राहा...';
        }
    }

    // -------------------------------------------------------------
    // 5. BOUT STATE MACHINE & CADENCE RANDOMIZER
    // -------------------------------------------------------------
    function startWorkPhase() {
        isRestPhase = false;
        roundTimeRemaining = WORK_INTERVAL_MS;
        updateHeaderLabels();
        scheduleNextRandomCadence(500); // Initial 500ms prep before first cue
    }

    function scheduleNextRandomCadence(delayOverride = null) {
        if (!isRunning || isPaused || isRestPhase) return;

        const tier = CADENCE_TIERS[currentTier];
        const nextDelay = delayOverride !== null 
            ? delayOverride 
            : Math.floor(Math.random() * (tier.max - tier.min + 1)) + tier.min;

        cadenceTimeout = setTimeout(() => {
            if (!isRunning || isPaused || isRestPhase) return;

            // Cadence distribution: 40% Advance, 30% Retreat, 20% Freeze, 10% Lunge
            const rand = Math.random();
            if (rand < 0.40) {
                currentAction = 'advance';
                setAmbientWash('advance');
                scheduleNextRandomCadence();
            } else if (rand < 0.70) {
                currentAction = 'retreat';
                setAmbientWash('retreat');
                scheduleNextRandomCadence();
            } else if (rand < 0.90) {
                currentAction = 'freeze';
                setAmbientWash('freeze');
                // Enforce 1.5 seconds of dead silence during the balance brake
                scheduleNextRandomCadence(1500);
            } else {
                currentAction = 'lunge';
                setAmbientWash('lunge');
                scheduleNextRandomCadence(1800);
            }
        }, nextDelay);
    }

    function startRestPhase() {
        isRestPhase = true;
        clearTimeout(cadenceTimeout);
        roundTimeRemaining = REST_INTERVAL_MS;
        setAmbientWash('rest');
        updateHeaderLabels();

        speakIntermissionCue("शाब्बास रीवा! पंधरा सेकंद विश्रांती घ्या, दीर्घ श्वास घे.");
    }

    function handleBoutCompletion() {
        isRunning = false;
        clearTimeout(cadenceTimeout);
        clearInterval(roundTickerInterval);
        setAmbientWash('finished');

        speakIntermissionCue("उत्कृष्ट सराव रीवा! आजचा मुकाबला पूर्ण झाला आहे.");
    }

    function runClockTick() {
        roundTimeRemaining -= 1000;
        if (roundTimeRemaining <= 0) {
            if (!isRestPhase) {
                if (currentRound >= TOTAL_ROUNDS) {
                    handleBoutCompletion();
                    return;
                }
                startRestPhase();
            } else {
                currentRound++;
                startWorkPhase();
            }
        }
        updateHeaderLabels();
    }

    function updateHeaderLabels() {
        const roundEl = document.getElementById('sparrerRoundPill');
        const clockEl = document.getElementById('sparrerClockPill');
        if (!roundEl || !clockEl) return;

        const sec = Math.max(0, Math.ceil(roundTimeRemaining / 1000));
        clockEl.innerText = `${sec} से.`;

        if (isRestPhase) {
            roundEl.innerText = `विश्रांती (फेरी ${currentRound}/${TOTAL_ROUNDS})`;
            roundEl.style.color = '#38bdf8';
        } else {
            roundEl.innerText = `फेरी ${currentRound}/${TOTAL_ROUNDS}`;
            roundEl.style.color = '#f8fafc';
        }
    }

    // -------------------------------------------------------------
    // 6. PUBLIC EXPORTED REACTION SPARRER INTERFACE
    // -------------------------------------------------------------
    window.RivaSparrer = {
        init: () => {
            ensureAudioContext();
            buildSparrerDOM();

            isRunning = true;
            isPaused = false;
            currentRound = 1;
            isRestPhase = false;
            roundTimeRemaining = WORK_INTERVAL_MS;

            setAmbientWash('idle');
            updateHeaderLabels();

            clearInterval(roundTickerInterval);
            clearTimeout(cadenceTimeout);
            roundTickerInterval = setInterval(runClockTick, 1000);

            setTimeout(() => {
                if (isRunning) startWorkPhase();
            }, 800);
        },

        stop: () => {
            isRunning = false;
            isPaused = false;
            clearInterval(roundTickerInterval);
            clearTimeout(cadenceTimeout);
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();

            // Restore neutral dashboard state
            if (container) {
                container.style.backgroundColor = '';
            }
        },

        setTier: (tierName) => {
            if (!CADENCE_TIERS[tierName]) return;
            currentTier = tierName;
            ['Beg', 'Med', 'Adv'].forEach(id => {
                const b = document.getElementById(`tierBtn${id}`);
                if (b) b.classList.remove('active');
            });
            if (tierName === 'beginner') document.getElementById('tierBtnBeg')?.classList.add('active');
            if (tierName === 'intermediate') document.getElementById('tierBtnMed')?.classList.add('active');
            if (tierName === 'advanced') document.getElementById('tierBtnAdv')?.classList.add('active');
        },

        triggerHeroTap: () => {
            // Tap-to-pause or re-sync during training
            if (!isRunning) return;
            isPaused = !isPaused;
            if (isPaused) {
                clearTimeout(cadenceTimeout);
                document.getElementById('sparrerSubText').innerText = '⏸️ थांबवले (सुरू करण्यासाठी टॅप करा)';
            } else {
                scheduleNextRandomCadence(400);
            }
        }
    };
})();
