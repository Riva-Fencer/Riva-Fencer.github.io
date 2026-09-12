/**
 * Riva Fencer - Cartridge 002 (Try #4)
 * Ported from Riva Drill 2.html (7 Sub-Drills)
 * Untouched Biomechanics, IK Engine, Web Audio Synthesizers, and Laser/Rubber-Band Overlays.
 */
(function () {
    const canvas = document.getElementById('fencingCanvas');
    const ctx = canvas.getContext('2d');
    const statusBox = document.getElementById('status-box');
    const badgeText = document.getElementById('drillHeaderBadgeText');
    const timerNumber = document.getElementById('timer-number');
    const timerProgress = document.getElementById('timerProgress');

    const BASE_WIDTH = 800;
    const BASE_HEIGHT = 420;
    const GROUND_Y = 312;
    const DRILL_DURATION = 30000;
    const TOTAL_SUB_DRILLS = 7;

    const SUB_DRILL_TITLES = [
        "१. 'एल' कोन",
        "२. ऑन-गार्द",
        "३. एस्केलेटर",
        "४. रबर बँड",
        "५. पाऊल क्रम",
        "६. घराचे छप्पर",
        "७. रॉकेट लंज"
    ];

    function setupHiDPI() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = BASE_WIDTH * dpr;
        canvas.height = BASE_HEIGHT * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    setupHiDPI();
    window.addEventListener('resize', setupHiDPI);

    let wakeLock = null;
    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try { wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {}
        }
    }

    // -------------------------------------------------------------
    // 1. SPATIAL RAYCASTING & ERROR HIT-TESTING ENGINE
    // -------------------------------------------------------------
    let activeErrorZones = [];
    let visualRipples = [];

    function registerErrorZone(id, x, y, radius, onCorrectCallback, label = "") {
        activeErrorZones.push({ id, x, y, radius, onCorrect: onCorrectCallback, label });
    }

    function clearErrorZones() {
        activeErrorZones = [];
    }

    function getCanvasPointerPos(evt) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = BASE_WIDTH / rect.width;
        const scaleY = BASE_HEIGHT / rect.height;
        const clientX = evt.clientX !== undefined ? evt.clientX : (evt.touches && evt.touches[0] ? evt.touches[0].clientX : 0);
        const clientY = evt.clientY !== undefined ? evt.clientY : (evt.touches && evt.touches[0] ? evt.touches[0].clientY : 0);
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function spawnSuccessRipple(x, y) {
        visualRipples.push({ x, y, radius: 8, maxRadius: 36, alpha: 1.0, color: '#22c55e' });
    }

    function spawnMissNotice(x, y) {
        visualRipples.push({ x, y, radius: 5, maxRadius: 22, alpha: 0.85, color: '#ef4444' });
        playErrorThud();
    }

    function updateAndDrawRipples() {
        for (let i = visualRipples.length - 1; i >= 0; i--) {
            const r = visualRipples[i];
            r.radius += 1.8;
            r.alpha -= 0.04;
            if (r.alpha <= 0) {
                visualRipples.splice(i, 1);
                continue;
            }
            ctx.save();
            ctx.strokeStyle = r.color;
            ctx.globalAlpha = r.alpha;
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    function drawActiveErrorReticles() {
        const pulse = Math.sin(performance.now() * 0.008) * 3.5;
        activeErrorZones.forEach(zone => {
            ctx.save();
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2.0;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(zone.x, zone.y, zone.radius + pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
            ctx.fill();

            ctx.fillStyle = '#fca5a5';
            ctx.font = 'bold 12px "Mukta", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(zone.label || "दुरुस्त कर", zone.x, zone.y - zone.radius - 6);
            ctx.restore();
        });
    }

    function resolveErrorCorrectionTap(clickX, clickY) {
        let corrected = false;
        for (let i = activeErrorZones.length - 1; i >= 0; i--) {
            const zone = activeErrorZones[i];
            const dist = Math.hypot(clickX - zone.x, clickY - zone.y);
            if (dist <= zone.radius) {
                spawnSuccessRipple(zone.x, zone.y);
                createParticleBurst(zone.x, zone.y, '#22c55e', 20);
                playHarmonicChime();
                zone.onCorrect();
                corrected = true;
                break;
            }
        }
        if (!corrected && activeErrorZones.length > 0) {
            spawnMissNotice(clickX, clickY);
        }
    }

    // -------------------------------------------------------------
    // 2. HIT-STOP, CAMERA SHAKE & SYNTHESIZED AUDIO
    // -------------------------------------------------------------
    let hitStopUntil = 0;
    let screenShakeRemaining = 0;
    let screenShakeMagnitude = 0;
    let wasInContactPreviousFrame = false;

    function triggerHitStop(freezeMs, shakeIntensity) {
        const now = performance.now();
        hitStopUntil = now + freezeMs;
        screenShakeRemaining = freezeMs;
        screenShakeMagnitude = shakeIntensity;
        if ('vibrate' in navigator) {
            try { navigator.vibrate(shakeIntensity > 3 ? [35, 25, 35] : 25); } catch (e) {}
        }
    }

    function applyCameraTransform() {
        ctx.save();
        if (screenShakeRemaining > 0) {
            const shakeX = (Math.random() - 0.5) * screenShakeMagnitude * 2;
            const shakeY = (Math.random() - 0.5) * screenShakeMagnitude * 2;
            ctx.translate(shakeX, shakeY);
            screenShakeRemaining -= 16.6;
            if (screenShakeRemaining <= 0) screenShakeMagnitude = 0;
        }
    }

    function restoreCameraTransform() {
        ctx.restore();
    }

    let audioCtx = null;
    let audioUnlocked = false;
    let isMuted = false;

    function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        audioUnlocked = true;
        requestWakeLock();
        auditVoices();
    }

    function playHarmonicChime() {
        if (!audioCtx || isMuted) return;
        const notes = [1046.50, 1318.51];
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const start = audioCtx.currentTime + (idx * 0.08);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(0.22, start);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(start); osc.stop(start + 0.35);
        });
    }

    function playErrorThud() {
        if (!audioCtx || isMuted) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const now = audioCtx.currentTime;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + 0.22);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(now); osc.stop(now + 0.22);
    }

    function playMetronomeTick() {
        if (!audioCtx || isMuted) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.04);
    }

    // -------------------------------------------------------------
    // 3. SANITIZED MULTILINGUAL TTS ENGINE
    // -------------------------------------------------------------
    const speechEngine = { marathiVoice: null, hindiVoice: null };

    function auditVoices() {
        if (!('speechSynthesis' in window)) return;
        const voices = window.speechSynthesis.getVoices() || [];
        speechEngine.marathiVoice = voices.find(v => v.lang.toLowerCase().includes('mr')) || null;
        speechEngine.hindiVoice = voices.find(v => v.lang.toLowerCase().includes('hi')) || null;
    }

    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = auditVoices;
        auditVoices();
    }

    function getPersonalized(str) {
        const saved = JSON.parse(localStorage.getItem('riva_athlete')) || { name: 'रीवा' };
        return str.replaceAll('रीवा', saved.name);
    }

    function sanitizeVoiceString(text) {
        return text
            .replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
            .replace(/[➔➡️⬅️⚡💡🐢⭐⏱️🔊⏸️🚀🤺📐🦶🦵🏠🛗🪢🤖🏎️💥🎈🔄❌✅🎯]/g, '')
            .replace(/[()]/g, '')
            .replace(/[०-९0-9]+[.]?[०-९0-9]*/g, '')
            .replace(/['"]/g, '')
            .trim();
    }

    function speakCoachingCue(marathiString) {
        if (!('speechSynthesis' in window) || !audioUnlocked || isMuted) return;
        window.speechSynthesis.cancel();

        const cleanText = sanitizeVoiceString(getPersonalized(marathiString));
        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);
        if (speechEngine.marathiVoice) {
            utterance.voice = speechEngine.marathiVoice;
            utterance.lang = 'mr-IN';
        } else if (speechEngine.hindiVoice) {
            utterance.voice = speechEngine.hindiVoice;
            utterance.lang = 'hi-IN';
        } else {
            utterance.lang = 'mr-IN';
        }

        utterance.rate = 0.88;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
    }

    function stopAllSpeech() {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    // -------------------------------------------------------------
    // 4. PARTICLES & DUST PUFF SYSTEM
    // -------------------------------------------------------------
    const particles = [];
    const dustPuffs = [];

    function createParticleBurst(x, y, color = '#22c55e', count = 18) {
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 / count) * i + (Math.random() * 0.4 - 0.2);
            const speed = 2.5 + Math.random() * 4.5;
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                alpha: 1,
                size: 2.5 + Math.random() * 3.5,
                color: Math.random() > 0.35 ? color : '#facc15'
            });
        }
    }

    function triggerLaunchDust(x, y) {
        for (let i = 0; i < 6; i++) {
            dustPuffs.push({
                x: x - (Math.random() * 8),
                y: y - 2 - (Math.random() * 4),
                vx: -(1.8 + Math.random() * 2.5),
                vy: -(0.3 + Math.random() * 0.8),
                radius: 4 + Math.random() * 5,
                alpha: 0.75
            });
        }
    }

    function updateAndDrawEffects() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy; p.vy += 0.14; p.alpha -= 0.028;
            if (p.alpha <= 0) { particles.splice(i, 1); continue; }
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        for (let i = dustPuffs.length - 1; i >= 0; i--) {
            const d = dustPuffs[i];
            d.x += d.vx; d.y += d.vy; d.radius += 0.35; d.alpha -= 0.035;
            if (d.alpha <= 0) { dustPuffs.splice(i, 1); continue; }
            ctx.save();
            ctx.fillStyle = `rgba(148, 163, 184, ${d.alpha})`;
            ctx.beginPath(); ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
    }

    // -------------------------------------------------------------
    // 5. TIMELINE CONFIGURATIONS (7 SUB-DRILLS)
    // -------------------------------------------------------------
    const drillTimelineConfigs = [
        {
            drillId: 0,
            title: "📐 १. पायांची अचूक पोझिशन ('एल' आकार)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "अरेरे रीवा! पुढचा पाय वाकडा झाला आहे, तोल जाईल! पुढच्या पायावर टॅप करून सरळ कर.", status: "❌ पुढचा पाय वाकडा झाला! (पायावर टॅप करून सरळ कर)", color: "#ef4444" },
                { startTime: 9000, subPhase: 1, marathiText: "मागचा पाय समोर फिरवू नकोस! मागच्या पायावर टॅप करून नव्वद अंशात फिरव.", status: "❌ मागचा पाय समोर फिरला! (मागच्या पायावर टॅप कर)", color: "#f97316" },
                { startTime: 18000, subPhase: 2, marathiText: "शाब्बास रीवा! दोन्ही पायांचा अचूक एल आकार तयार झाला आहे!", status: "✅ अचूक 'एल' पोझिशन व पायांमधील योग्य अंतर पूर्ण!", color: "#22c55e" }
            ]
        },
        {
            drillId: 1,
            title: "🏎️ २. ऑन-गार्द पोझिशन (गुडघ्यांची स्प्रिंग पॉवर)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "अगं रीवा, गंजलेल्या रोबोसारखी ताठ उभी राहू नकोस! गुडघ्यांवर टॅप कर.", status: "❌ चूक: पाय ताठ ठेवल्यास चपळता संपते! (गुडघ्यांवर टॅप कर)", color: "#ef4444" },
                { startTime: 12000, subPhase: 1, marathiText: "छान! सुपरकारसारखी स्प्रिंग पॉवर, गुडघे ११० अंश वाकवून सज्ज राहा!", status: "✅ योग्य ऑन-गार्द: गुडघे ११० अंश वाकवून स्प्रिंगसारखे तयार ठेवा!", color: "#22c55e" }
            ]
        },
        {
            drillId: 2,
            title: "🛗 ३. एस्केलेटर ग्लाइड (सपाट हालचाल)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "थांब रीवा! उड्या मारल्यास डोकं छताला आपटेल! डोक्यावर टॅप कर.", status: "❌ उड्या मारू नकोस, डोकं छताला धडकेल! (डोक्यावर टॅप कर)", color: "#ef4444" },
                { startTime: 14000, subPhase: 1, marathiText: "सुंदर! मॉलच्या एस्केलेटरसारखी जमिनीवर गुळगुळीत आणि सपाट सरक!", status: "✅ मॉलच्या एस्केलेटरसारखे गुळगुळीत व सपाट सरका!", color: "#22c55e" }
            ]
        },
        {
            drillId: 3,
            title: "🪢 ४. पायांमधील ताण (योग्य अंतर)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "अगं रीवा! दोन्ही पावले जवळ आली, रबर सैल पडला! पावलांवर टॅप करून अंतर वाढव.", status: "❌ पाय जवळ आले, रबर सैल पडला! (पावलांवर टॅप कर)", color: "#ef4444" },
                { startTime: 10000, subPhase: 1, marathiText: "थांब रीवा! जास्त लांब पाऊल टाकू नकोस, रबर तुटेल! पावलांवर टॅप करून अंतर कमी कर.", status: "❌ पाय जास्त लांब गेले, रबर जास्त ताणला! (पावलांवर टॅप कर)", color: "#f97316" },
                { startTime: 19000, subPhase: 2, marathiText: "उत्कृष्ट रीवा! पायांमधील हा योग्य ताण असाच कायम ठेव!", status: "✅ उत्तम रीवा! पायांमधील योग्य अंतर व ताण कायम!", color: "#22c55e" }
            ]
        },
        {
            drillId: 4,
            title: "🦶 ५. पाऊल क्रम (टाच आणि चवडा)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "पुढे जाताना: आधी पुढची टाच टेकवून नाणं दाब, मग मागचा पाय पुढे आण!", status: "➡️ पुढे जाताना: आधी टाच ➔ मग चवडा टेकवा!", color: "#38bdf8" },
                { startTime: 15000, subPhase: 1, marathiText: "मागे येताना: मांजरासारखी आधी मागच्या चवड्यावर हलके पाऊल ठेव, मग पुढचा पाय मागे घे!", status: "⬅️ मागे येताना: आधी चवडा ➔ मग टाच टेकवा!", color: "#4ade80" }
            ]
        },
        {
            drillId: 5,
            title: "🏠 ६. घराचे छप्पर (पाठीचा समतोल कणा)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "अरेरे! पुढे झुकू नकोस, तोल जाईल! छातीवर टॅप करून सरळ उभी राहा.", status: "❌ पुढे झुकू नकोस, तोल जाईल! (छातीवर टॅप कर)", color: "#ef4444" },
                { startTime: 10000, subPhase: 1, marathiText: "मागे झुकू नकोस, गाडी मागे पळेल! छातीवर टॅप करून दोन्ही पायांवर समान भार ठेव.", status: "❌ मागे झुकू नकोस, तोल सांभाळ! (छातीवर टॅप कर)", color: "#f97316" },
                { startTime: 19000, subPhase: 2, marathiText: "फार छान रीवा! पाठीचा कणा ताठ आणि शरीर दोन्ही पायांवर समतोल झाले आहे!", status: "✅ पाठीचा कणा ताठ व दोन्ही पायांवर समतोल!", color: "#22c55e" }
            ]
        },
        {
            drillId: 6,
            title: "🚀 ७. रॉकेट लंज आणि अचूक स्पर्श",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "लक्ष्य डमीवर रोखून धर, लंजसाठी स्प्रिंग तयार ठेव... तीन, दोन, एक!", status: "🎯 नजर डमीवर रोखून धरा... तीन, दोन, एक!", color: "#38bdf8" },
                { startTime: 7500, subPhase: 1, marathiText: "हात आधी सरळ कर, मागच्या पायाने धक्का दे, आणि नव्वद अंशात रॉकेट लंज मार!", status: "💥 हात आधी ➔ मागच्या पायाचा धक्का ➔ ९०° अचूक लंज!", color: "#facc15" },
                { startTime: 21500, subPhase: 2, marathiText: "पुढच्या टाचेने जमिनीला मागे ढकलून झटक्यात ऑन-गार्द पोझिशनवर परत ये!", status: "🔄 पुढच्या टाचेने जमिनीला ढकला व ऑन-गार्दवर परत या!", color: "#4ade80" }
            ]
        }
    ];

    let effectiveElapsed = 0;
    let lastFrameTime = performance.now();
    let isPaused = false;
    let currentPlaybackSpeed = 1.0;
    let isSlowMoHold = false;
    let currentDrill = 0;
    let currentSubPhase = -1;
    let lastBeatSecond = -1;
    let dummyHitInCycle = false;

    // SCREEN TOUCH-HOLD SLOW-MOTION
    let pointerDownTime = 0;
    let holdTimeout = null;

    canvas.addEventListener('pointerdown', (e) => {
        initAudio();
        pointerDownTime = performance.now();
        holdTimeout = setTimeout(() => { isSlowMoHold = true; }, 180);
    });

    canvas.addEventListener('pointerup', (e) => {
        clearTimeout(holdTimeout);
        const holdDuration = performance.now() - pointerDownTime;
        isSlowMoHold = false;
        if (holdDuration < 240) {
            const pos = getCanvasPointerPos(e);
            resolveErrorCorrectionTap(pos.x, pos.y);
        }
    });

    canvas.addEventListener('pointercancel', () => {
        clearTimeout(holdTimeout);
        isSlowMoHold = false;
    });

    // -------------------------------------------------------------
    // 6. ANATOMICAL INVERSE KINEMATICS & PROPORTIONAL RENDERING
    // -------------------------------------------------------------
    function solveLegIK(hx, hy, ax, ay, l1, l2, bendForward = true) {
        const dx = ax - hx;
        const dy = ay - hy;
        let d = Math.hypot(dx, dy);
        d = Math.min(d, l1 + l2 - 0.001);
        d = Math.max(d, Math.abs(l1 - l2) + 0.001);

        const baseAngle = Math.atan2(dy, dx);
        const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
        const offset = Math.acos(Math.max(-1, Math.min(1, cosA)));
        const angle = bendForward ? (baseAngle - offset) : (baseAngle + offset);

        return {
            kx: hx + Math.cos(angle) * l1,
            ky: hy + Math.sin(angle) * l1
        };
    }

    function drawAnatomicalContouredLeg(hx, hy, kx, ky, ax, ay, isFront) {
        ctx.save();
        const baseColor = isFront ? '#f8fafc' : '#cbd5e1';
        const shadeColor = isFront ? '#cbd5e1' : '#94a3b8';
        const seamColor = isFront ? '#94a3b8' : '#64748b';

        const fAngle = Math.atan2(ky - hy, kx - hx);
        const fPerp = fAngle + Math.PI / 2;
        const qMidX = (hx + kx) * 0.5;
        const qMidY = (hy + ky) * 0.5;
        const qBulge = isFront ? 4.2 : 2.5;

        ctx.fillStyle = baseColor;
        ctx.strokeStyle = seamColor;
        ctx.lineWidth = 1.2;

        ctx.beginPath();
        ctx.moveTo(hx - Math.cos(fPerp) * 6.5, hy - Math.sin(fPerp) * 6.5);
        ctx.quadraticCurveTo(qMidX + Math.cos(fPerp) * (7 + qBulge), qMidY + Math.sin(fPerp) * (7 + qBulge), kx + Math.cos(fPerp) * 5.0, ky + Math.sin(fPerp) * 5.0);
        ctx.lineTo(kx - Math.cos(fPerp) * 4.5, ky - Math.sin(fPerp) * 4.5);
        ctx.quadraticCurveTo(qMidX - Math.cos(fPerp) * 5.0, qMidY - Math.sin(fPerp) * 5.0, hx + Math.cos(fPerp) * 6.0, hy + Math.sin(fPerp) * 6.0);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        const tAngle = Math.atan2(ay - ky, ax - kx);
        const tPerp = tAngle + Math.PI / 2;
        const cMidX = (kx + ax) * 0.5;
        const cMidY = (ky + ay) * 0.5;
        const cBulge = isFront ? -4.5 : -2.8;

        ctx.beginPath();
        ctx.moveTo(kx + Math.cos(tPerp) * 4.8, ky + Math.sin(tPerp) * 4.8);
        ctx.quadraticCurveTo(cMidX + Math.cos(tPerp) * (5.5 + cBulge), cMidY + Math.sin(tPerp) * (5.5 + cBulge), ax + Math.cos(tPerp) * 3.5, ay + Math.sin(tPerp) * 3.5);
        ctx.lineTo(ax - Math.cos(tPerp) * 3.2, ay - Math.sin(tPerp) * 3.2);
        ctx.quadraticCurveTo(cMidX - Math.cos(tPerp) * 4.5, cMidY - Math.sin(tPerp) * 4.5, kx - Math.cos(tPerp) * 4.2, ky - Math.sin(tPerp) * 4.2);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = shadeColor;
        ctx.beginPath();
        ctx.arc(kx, ky, 3.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function drawAuthenticShoe(x, y, tiltDeg, isFront, isTurned90, instepRollDeg = 0) {
        ctx.save();
        ctx.translate(x, y);

        if (isTurned90) {
            if (instepRollDeg !== 0) {
                ctx.translate(-7, 0);
                ctx.rotate((instepRollDeg * Math.PI) / 180);
                ctx.translate(7, 0);
            }

            ctx.fillStyle = '#0284c7';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.roundRect(-7, -8, 14, 8, [3, 3, 2, 2]);
            ctx.fill(); ctx.stroke();

            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(-7, -2.5, 14, 2.5);
        } else {
            ctx.rotate((tiltDeg * Math.PI) / 180);
            ctx.fillStyle = '#0284c7';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.1;

            ctx.beginPath();
            ctx.moveTo(-8, -8);
            ctx.lineTo(5, -8);
            ctx.quadraticCurveTo(13, -4.5, 14, -1);
            ctx.lineTo(-8, -1);
            ctx.quadraticCurveTo(-10, -4.5, -8, -8);
            ctx.closePath();
            ctx.fill(); ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(-9, -2.5, 23, 2.5, [1, 1, 1, 1]);
            ctx.fill();

            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-2, -7); ctx.lineTo(2, -4);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawFoilLameVest(pelvisX, pelvisY, shoulderX, shoulderY, isError = false) {
        ctx.save();
        ctx.fillStyle = isError ? '#fca5a5' : '#0284c7';
        ctx.strokeStyle = isError ? '#ef4444' : '#38bdf8';
        ctx.lineWidth = 1.4;

        ctx.beginPath();
        ctx.moveTo(shoulderX - 10, shoulderY + 8);
        ctx.lineTo(shoulderX + 10, shoulderY + 8);
        ctx.lineTo(pelvisX + 8, pelvisY);
        ctx.quadraticCurveTo(pelvisX, pelvisY + 5, pelvisX - 8, pelvisY);
        ctx.lineTo(shoulderX - 10, shoulderY + 8);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(shoulderX - 4, shoulderY + 9); ctx.lineTo(pelvisX - 3, pelvisY);
        ctx.moveTo(shoulderX + 4, shoulderY + 9); ctx.lineTo(pelvisX + 3, pelvisY);
        ctx.stroke();
        ctx.restore();
    }

    function drawAuthenticMask(headX, headY, gazeTargetX, gazeTargetY, isError = false) {
        ctx.save();
        ctx.fillStyle = '#0284c7';
        ctx.strokeStyle = isError ? '#ef4444' : '#64748b';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(headX - 10, headY + 8);
        ctx.quadraticCurveTo(headX + 12, headY + 16, headX + 7, headY + 22);
        ctx.lineTo(headX - 2, headY + 22);
        ctx.quadraticCurveTo(headX + 2, headY + 15, headX + 10, headY + 8);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#0b111e';
        ctx.strokeStyle = isError ? '#ef4444' : '#38bdf8';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(headX, headY, 12.5, 15.5, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
        ctx.lineWidth = 0.8;
        for (let i = -8; i <= 8; i += 3.5) {
            ctx.beginPath();
            ctx.moveTo(headX + i, headY - 11);
            ctx.lineTo(headX + i, headY + 11);
            ctx.stroke();
        }

        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(headX, headY, 13, Math.PI * 0.25, Math.PI * 0.75);
        ctx.stroke();

        ctx.restore();
    }

    function calculateEulerBladeBuckle(handX, handY, angleDeg, targetX, targetY) {
        const bladeLen = 104;
        const rad = (angleDeg * Math.PI) / 180;
        const undeflectedTipX = handX + Math.cos(rad) * bladeLen;
        const undeflectedTipY = handY + Math.sin(rad) * bladeLen;

        if (targetX <= 0 || undeflectedTipX < targetX) {
            return {
                isBent: false,
                p0: { x: handX, y: handY },
                tip: { x: undeflectedTipX, y: undeflectedTipY }
            };
        }

        const tipX = targetX;
        const tipY = targetY;
        const penetration = undeflectedTipX - targetX;

        const nodeX = handX + (bladeLen * 0.68) * Math.cos(rad);
        const nodeY = handY + (bladeLen * 0.68) * Math.sin(rad);

        const normalAngle = rad - (Math.PI / 2);
        const buckleDepth = 10.0 + (penetration * 0.82);

        const ctrlX = nodeX + Math.cos(normalAngle) * buckleDepth;
        const ctrlY = nodeY + Math.sin(normalAngle) * buckleDepth;

        return {
            isBent: true,
            p0: { x: handX, y: handY },
            pCtrl: { x: ctrlX, y: ctrlY },
            tip: { x: tipX, y: tipY }
        };
    }

    function drawAuthenticFoil(handX, handY, angleDeg, targetX, targetY) {
        const spine = calculateEulerBladeBuckle(handX, handY, angleDeg, targetX, targetY);
        const rad = (angleDeg * Math.PI) / 180;

        ctx.save();
        ctx.translate(handX, handY);
        ctx.rotate(rad);
        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.1;

        ctx.beginPath();
        ctx.ellipse(0, 0, 3.8, 10, 0, -Math.PI / 2, Math.PI / 2, true);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-1.5, -6, 1.8, 12);
        ctx.restore();

        ctx.save();
        ctx.lineCap = 'round';

        if (spine.isBent) {
            if (!wasInContactPreviousFrame) {
                triggerHitStop(70, 4.0);
            }
            wasInContactPreviousFrame = true;

            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(spine.p0.x, spine.p0.y);
            ctx.quadraticCurveTo(spine.pCtrl.x, spine.pCtrl.y, spine.tip.x, spine.tip.y);
            ctx.stroke();

            drawElectronicPointGlow(spine.tip.x, spine.tip.y);
        } else {
            wasInContactPreviousFrame = false;
            const midX = spine.p0.x + (spine.tip.x - spine.p0.x) * 0.55;
            const midY = spine.p0.y + (spine.tip.y - spine.p0.y) * 0.55;

            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(spine.p0.x, spine.p0.y);
            ctx.lineTo(midX, midY);
            ctx.stroke();

            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(midX, midY);
            ctx.lineTo(spine.tip.x, spine.tip.y);
            ctx.stroke();

            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(spine.tip.x, spine.tip.y, 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawElectronicPointGlow(x, y) {
        ctx.save();
        const grad = ctx.createRadialGradient(x, y, 1, x, y, 12);
        grad.addColorStop(0, 'rgba(34, 197, 94, 1.0)');
        grad.addColorStop(0.45, 'rgba(74, 222, 128, 0.7)');
        grad.addColorStop(1, 'rgba(34, 197, 94, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawFloor(groundY) {
        const stripGrad = ctx.createLinearGradient(0, groundY, 0, BASE_HEIGHT);
        stripGrad.addColorStop(0, '#1a2436');
        stripGrad.addColorStop(1, '#0b111e');
        ctx.fillStyle = stripGrad;
        ctx.fillRect(0, groundY, BASE_WIDTH, BASE_HEIGHT - groundY);

        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(BASE_WIDTH, groundY); ctx.stroke();

        ctx.fillStyle = '#334155';
        for (let m = 40; m < BASE_WIDTH; m += 40) ctx.fillRect(m, groundY, 2, 8);
    }

    function drawFencingTargetDummy(x, groundY, targetY) {
        ctx.save();
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x + 2, groundY - 8, 48, 8, [4, 4, 1, 1]);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#334155';
        ctx.fillRect(x + 22, targetY - 45, 8, groundY - (targetY - 45));

        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x - 2, targetY - 40, 24, 76, [8, 8, 8, 8]);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(x + 1, targetY, 15, -Math.PI / 2, Math.PI / 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x + 1, targetY, 9, -Math.PI / 2, Math.PI / 2); ctx.fill();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(x + 1, targetY, 4, -Math.PI / 2, Math.PI / 2); ctx.fill();

        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 13px "Mukta", sans-serif';
        ctx.fillText("डमी पोस्ट 🎯", x - 20, targetY + 52);
        ctx.restore();
    }

    function drawU10Fencer(cfg) {
        const {
            pelvisX, pelvisY,
            frontFootX, frontFootY, frontTilt = 0,
            rearFootX, rearFootY, rearTilt = 0,
            rearFootTurned90 = true,
            frontFootTurned = false,
            rearFootInstepRoll = 0,
            torsoIncline = 0,
            armState = 'enGarde',
            armExtension = 0,
            bladeAngle = -4,
            targetSurfaceX = 0,
            targetSurfaceY = 0,
            isError = false,
            rearArmActiveLunge = 0,
            gazeTargetX = 0,
            gazeTargetY = 0,
            label = ""
        } = cfg;

        const femur = 46;
        const tibia = 43;

        const rearHipX = pelvisX - 5;
        const rearHipY = pelvisY;
        const rearAnkleY = rearFootY - 6;
        const rearIK = solveLegIK(rearHipX, rearHipY, rearFootX, rearAnkleY, femur, tibia, false);
        drawAnatomicalContouredLeg(rearHipX, rearHipY, rearIK.kx, rearIK.ky, rearFootX, rearAnkleY, false);
        drawAuthenticShoe(rearFootX, rearFootY, rearTilt, false, rearFootTurned90, rearFootInstepRoll);

        const frontHipX = pelvisX + 5;
        const frontHipY = pelvisY;
        const frontAnkleY = frontFootY - 6;
        const frontIK = solveLegIK(frontHipX, frontHipY, frontFootX, frontAnkleY, femur, tibia, true);
        drawAnatomicalContouredLeg(frontHipX, frontHipY, frontIK.kx, frontIK.ky, frontFootX, frontAnkleY, true);
        drawAuthenticShoe(frontFootX, frontFootY, frontTilt, true, frontFootTurned, 0);

        const shoulderX = pelvisX + 3 + (torsoIncline * 10);
        const shoulderY = pelvisY - 50;

        ctx.save();
        ctx.fillStyle = isError ? '#fca5a5' : '#f1f5f9';
        ctx.beginPath();
        ctx.roundRect(pelvisX - 9, pelvisY - 4, 18, 9, [2, 2, 3, 3]);
        ctx.fill();
        ctx.restore();

        drawFoilLameVest(pelvisX, pelvisY, shoulderX, shoulderY, isError);

        const bShoulderX = shoulderX - 7;
        const bShoulderY = shoulderY + 8;
        ctx.save();
        ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 3.6; ctx.lineCap = 'round';

        if (rearArmActiveLunge > 0) {
            const snap = rearArmActiveLunge;
            const bElbowX = (1 - snap) * (bShoulderX - 12) + snap * (bShoulderX - 24);
            const bElbowY = (1 - snap) * (bShoulderY - 12) + snap * (bShoulderY + 8);
            const bHandX = (1 - snap) * (bElbowX + 4) + snap * (bShoulderX - 42);
            const bHandY = (1 - snap) * (bElbowY - 12) + snap * (bShoulderY + 18);

            ctx.beginPath(); ctx.moveTo(bShoulderX, bShoulderY);
            ctx.lineTo(bElbowX, bElbowY); ctx.lineTo(bHandX, bHandY); ctx.stroke();
        } else {
            const bElbowX = bShoulderX - 12;
            const bElbowY = bShoulderY - 12;
            const bHandX = bElbowX + 4;
            const bHandY = bElbowY - 12;

            ctx.beginPath(); ctx.moveTo(bShoulderX, bShoulderY);
            ctx.lineTo(bElbowX, bElbowY); ctx.lineTo(bHandX, bHandY); ctx.stroke();
        }
        ctx.restore();

        const headX = shoulderX + 3;
        const headY = shoulderY - 18;
        drawAuthenticMask(headX, headY, gazeTargetX, gazeTargetY, isError);

        if (label) {
            ctx.save();
            ctx.fillStyle = isError ? '#ef4444' : '#22c55e';
            ctx.font = 'bold 14px "Mukta", sans-serif';
            ctx.fillText(label, headX - 40, headY - 22);
            ctx.restore();
        }

        const fShoulderX = shoulderX + 7;
        const fShoulderY = shoulderY + 10;

        let handX, handY;
        ctx.save();
        ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 3.8; ctx.lineCap = 'round';

        if (armState === 'enGarde') {
            handX = fShoulderX + 24;
            handY = fShoulderY + 2;
            const elbowX = fShoulderX + 12;
            const elbowY = fShoulderY + 12;

            ctx.beginPath(); ctx.moveTo(fShoulderX, fShoulderY);
            ctx.lineTo(elbowX, elbowY); ctx.lineTo(handX, handY); ctx.stroke();
            ctx.restore();
            drawAuthenticFoil(handX, handY, bladeAngle, 0, 0);
        } else {
            const maxReach = 44;
            const currentReach = 24 + (armExtension * (maxReach - 24));
            handX = fShoulderX + currentReach;
            handY = fShoulderY - (armExtension * 3.0);
            const elbowX = fShoulderX + (currentReach * 0.52);
            const elbowY = fShoulderY + (12 * (1 - armExtension));

            ctx.beginPath(); ctx.moveTo(fShoulderX, fShoulderY);
            ctx.lineTo(elbowX, elbowY); ctx.lineTo(handX, handY); ctx.stroke();
            ctx.restore();
            drawAuthenticFoil(handX, handY, bladeAngle, targetSurfaceX, targetSurfaceY);
        }
    }

    // -------------------------------------------------------------
    // DRILL 1 TO 7 IMPLEMENTATIONS
    // -------------------------------------------------------------
    function renderDrill1_FootAngles(t) {
        drawFloor(GROUND_Y);
        clearErrorZones();

        const phase = t < 9000 ? 0 : (t < 18000 ? 1 : 2);
        const fencerX = 400;

        if (phase === 0) {
            registerErrorZone('d1_front_foot', fencerX + 24, GROUND_Y - 8, 22, () => {
                effectiveElapsed = 9005;
            }, "पुढचा पाय सरळ कर");

            drawU10Fencer({
                pelvisX: fencerX, pelvisY: 254,
                frontFootX: fencerX + 24, frontFootY: GROUND_Y, frontTilt: 0,
                rearFootX: fencerX - 24, rearFootY: GROUND_Y, rearTilt: 0,
                rearFootTurned90: true, frontFootTurned: true,
                isError: true
            });
        } else if (phase === 1) {
            registerErrorZone('d1_rear_foot', fencerX - 24, GROUND_Y - 8, 22, () => {
                effectiveElapsed = 18005;
            }, "मागचा पाय ९०° फिरव");

            drawU10Fencer({
                pelvisX: fencerX, pelvisY: 254,
                frontFootX: fencerX + 24, frontFootY: GROUND_Y, frontTilt: 0,
                rearFootX: fencerX - 24, rearFootY: GROUND_Y, rearTilt: 0,
                rearFootTurned90: false, frontFootTurned: false,
                isError: true
            });
        } else {
            drawU10Fencer({
                pelvisX: fencerX, pelvisY: 254,
                frontFootX: fencerX + 24, frontFootY: GROUND_Y, frontTilt: 0,
                rearFootX: fencerX - 24, rearFootY: GROUND_Y, rearTilt: 0,
                rearFootTurned90: true, frontFootTurned: false,
                isError: false
            });
        }
    }

    function renderDrill2_TinManVsCar(t) {
        drawFloor(GROUND_Y);
        clearErrorZones();

        const phase = t < 12000 ? 0 : 1;
        const fencerX = 400;

        if (phase === 0) {
            registerErrorZone('d2_locked_knees', fencerX, 260, 28, () => {
                effectiveElapsed = 12005;
            }, "गुडघे वाकव");

            drawU10Fencer({
                pelvisX: fencerX, pelvisY: 238,
                frontFootX: fencerX + 22, frontFootY: GROUND_Y,
                rearFootX: fencerX - 22, rearFootY: GROUND_Y,
                rearFootTurned90: true,
                isError: true, label: "🤖 ताठ रोबोट (अक्षम)"
            });
        } else {
            const muscleTension = Math.sin(t * 0.04) * 0.4;
            drawU10Fencer({
                pelvisX: fencerX, pelvisY: 254 + muscleTension,
                frontFootX: fencerX + 24, frontFootY: GROUND_Y,
                rearFootX: fencerX - 24, rearFootY: GROUND_Y,
                rearFootTurned90: true,
                isError: false, label: "🏎️ सुपरकार स्प्रिंग मोड"
            });
        }
    }

    function renderDrill3_EscalatorGlide(t) {
        drawFloor(GROUND_Y);
        clearErrorZones();

        const laserCeilingY = 175;
        const phase = t < 14000 ? 0 : 1;

        let fencerX, pelvisY;
        let frontX, backX, frontTilt = 0, rearTilt = 0, frontY = GROUND_Y, backY = GROUND_Y;

        if (phase === 0) {
            const p = (t / 14000);
            const cycle = (p * 4) % 1;
            fencerX = 400 + (Math.sin(p * Math.PI * 2) * 110);
            const pelvisBob = -Math.abs(Math.sin(cycle * Math.PI)) * 24;
            pelvisY = 254 + pelvisBob;
            frontX = fencerX + 24;
            backX = fencerX - 24;

            registerErrorZone('d3_bobbing_head', fencerX, pelvisY - 55, 30, () => {
                effectiveElapsed = 14005;
            }, "सपाट सरक");

            if (pelvisBob < -12) {
                ctx.fillStyle = '#ef4444'; ctx.font = 'bold 15px "Mukta", sans-serif';
                ctx.fillText("💥 डोके छताला धडकले!", fencerX - 60, laserCeilingY - 14);
            }
        } else {
            pelvisY = 254;
            const p = ((t - 14000) / 16000);
            const baseStance = 48;
            const stepDist = 38;
            const startX = 350;

            const cycleP = (p * 2) % 1;
            const isAdvancing = (p * 2) < 1;

            if (isAdvancing) {
                if (cycleP < 0.5) {
                    const subP = cycleP / 0.5;
                    backX = startX - baseStance / 2;
                    frontX = startX + baseStance / 2 + (subP * stepDist);
                    frontTilt = subP < 0.8 ? -18 : -18 * (1 - (subP - 0.8) / 0.2);
                    frontY = subP < 0.8 ? GROUND_Y - (4.0 * Math.sin((subP / 0.8) * Math.PI)) : GROUND_Y;
                    fencerX = startX + (Math.max(0, subP - 0.3) / 0.7) * (stepDist * 0.5);
                } else {
                    const subP = (cycleP - 0.5) / 0.5;
                    frontX = startX + baseStance / 2 + stepDist;
                    backX = startX - baseStance / 2 + (subP * stepDist);
                    rearTilt = 12 * Math.sin(subP * Math.PI);
                    backY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                    fencerX = startX + (stepDist * 0.5) + (subP * stepDist * 0.5);
                }
            } else {
                const reachedFront = startX + baseStance / 2 + stepDist;
                const reachedBack = startX - baseStance / 2 + stepDist;
                if (cycleP < 0.5) {
                    const subP = cycleP / 0.5;
                    frontX = reachedFront;
                    backX = reachedBack - (subP * stepDist);
                    rearTilt = 18 * Math.sin(subP * Math.PI);
                    backY = GROUND_Y - (4.5 * Math.sin(subP * Math.PI));
                    fencerX = startX + stepDist - (Math.max(0, subP - 0.3) / 0.7) * (stepDist * 0.5);
                } else {
                    const subP = (cycleP - 0.5) / 0.5;
                    backX = startX - baseStance / 2;
                    frontX = reachedFront - (subP * stepDist);
                    frontTilt = -14 * Math.sin(subP * Math.PI);
                    frontY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                    fencerX = startX + (stepDist * 0.5) - (subP * stepDist * 0.5);
                }
            }
        }

        ctx.save();
        ctx.strokeStyle = phase === 0 && (pelvisY < 244) ? '#ef4444' : '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(60, laserCeilingY);
        ctx.lineTo(740, laserCeilingY);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = 'bold 13px "Mukta", sans-serif';
        ctx.fillText("⚡ लेझर छताची रेषा (Laser Ceiling Limit) ⚡", 290, laserCeilingY - 8);

        drawU10Fencer({
            pelvisX: fencerX, pelvisY: pelvisY,
            frontFootX: frontX, frontFootY: frontY, frontTilt: frontTilt,
            rearFootX: backX, rearFootY: backY, rearTilt: rearTilt,
            rearFootTurned90: true,
            isError: phase === 0
        });
    }

    function drawRubberBandGraphics(x, groundY, footGap, state) {
        const leftX = x - 24;
        const rightX = x + footGap;
        const bandY = groundY - 8;

        ctx.save();
        if (state === "normal") {
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3.5;
            ctx.beginPath(); ctx.moveTo(leftX, bandY); ctx.lineTo(rightX, bandY); ctx.stroke();
            ctx.fillStyle = '#22c55e'; ctx.font = 'bold 14px "Mukta", sans-serif';
            ctx.fillText("🟢 रबर बँडचा अचूक ताण!", x - 65, bandY - 18);
        } else if (state === "loose") {
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(leftX, bandY); ctx.quadraticCurveTo(x, bandY + 16, rightX, bandY); ctx.stroke();
            ctx.fillStyle = '#ef4444'; ctx.font = 'bold 14px "Mukta", sans-serif';
            ctx.fillText("🔴 रबर सैल पडला!", x - 50, bandY - 18);
        } else if (state === "snapped") {
            ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(leftX, bandY); ctx.lineTo(x - 6, bandY - 6);
            ctx.moveTo(x + 14, bandY + 6); ctx.lineTo(rightX, bandY); ctx.stroke();
            ctx.fillStyle = '#f97316'; ctx.font = 'bold 14px "Mukta", sans-serif';
            ctx.fillText("⚡ रबर जास्त ताणला!", x - 60, bandY - 18);
        }
        ctx.restore();
    }

    function renderDrill4_RubberBand(t) {
        drawFloor(GROUND_Y);
        clearErrorZones();

        const phase = t < 10000 ? 0 : (t < 19000 ? 1 : 2);
        const fencerX = 400;
        let footGap = 24;
        let bandState = "normal";

        if (phase === 0) {
            footGap = 8;
            bandState = "loose";
            registerErrorZone('d4_feet_close', fencerX, GROUND_Y - 12, 32, () => {
                effectiveElapsed = 10005;
            }, "अंतर वाढव");
        } else if (phase === 1) {
            footGap = 52;
            bandState = "snapped";
            registerErrorZone('d4_feet_wide', fencerX + 24, GROUND_Y - 12, 32, () => {
                effectiveElapsed = 19005;
            }, "अंतर कमी कर");
        } else {
            footGap = 24;
            bandState = "normal";
        }

        drawU10Fencer({
            pelvisX: fencerX - (24 - footGap) * 0.25,
            pelvisY: phase === 0 ? 246 : 254,
            frontFootX: fencerX + footGap, frontFootY: GROUND_Y,
            rearFootX: fencerX - 24, rearFootY: GROUND_Y,
            rearFootTurned90: true,
            isError: phase !== 2
        });

        drawRubberBandGraphics(fencerX, GROUND_Y, footGap, bandState);
    }

    function renderDrill5_StepRoll(t) {
        drawFloor(GROUND_Y);
        clearErrorZones();

        const baseStance = 48;
        const stepDist = 38;
        const centerX = 380;

        let frontX, backX, frontTilt = 0, rearTilt = 0, frontY = GROUND_Y, backY = GROUND_Y;
        let pelvisOffset = 0;

        if (t < 15000) {
            const p = (t / 15000);
            if (p < 0.5) {
                const subP = p / 0.5;
                backX = centerX - baseStance / 2;
                frontX = centerX + baseStance / 2 + (subP * stepDist);
                if (subP < 0.8) {
                    frontTilt = -18;
                    frontY = GROUND_Y - (4.5 * Math.sin((subP / 0.8) * Math.PI));
                } else {
                    const landP = (subP - 0.8) / 0.2;
                    frontTilt = -18 * (1 - landP);
                    frontY = GROUND_Y;
                }
                pelvisOffset = Math.max(0, subP - 0.35) / 0.65 * (stepDist * 0.5);
            } else {
                const subP = (p - 0.5) / 0.5;
                frontX = centerX + baseStance / 2 + stepDist;
                backX = centerX - baseStance / 2 + (subP * stepDist);
                rearTilt = 12 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) + (subP * stepDist * 0.5);
            }
        } else {
            const p = ((t - 15000) / 15000);
            const advancedFrontX = centerX + baseStance / 2 + stepDist;
            const advancedBackX = centerX - baseStance / 2 + stepDist;

            if (p < 0.5) {
                const subP = p / 0.5;
                frontX = advancedFrontX;
                backX = advancedBackX - (subP * stepDist);
                rearTilt = 18 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (4.5 * Math.sin(subP * Math.PI));
                pelvisOffset = stepDist - (Math.max(0, subP - 0.35) / 0.65 * (stepDist * 0.5));
            } else {
                const subP = (p - 0.5) / 0.5;
                backX = centerX - baseStance / 2;
                frontX = advancedFrontX - (subP * stepDist);
                frontTilt = -14 * Math.sin(subP * Math.PI);
                frontY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) - (subP * stepDist * 0.5);
            }
        }

        drawU10Fencer({
            pelvisX: centerX + pelvisOffset, pelvisY: 254,
            frontFootX: frontX, frontFootY: frontY, frontTilt: frontTilt,
            rearFootX: backX, rearFootY: backY, rearTilt: rearTilt,
            rearFootTurned90: true,
            isError: false
        });
    }

    function drawHouseRoofOverlay(x, groundY) {
        const hipY = groundY - 58;
        const backFootX = x - 24;
        const frontFootX = x + 24;

        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(backFootX, groundY);
        ctx.lineTo(x, hipY - 60);
        ctx.lineTo(frontFootX, groundY);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 13px "Mukta", sans-serif';
        ctx.fillText("🔺 कण्याचा अचूक समतोल (Apex)", x - 80, hipY - 68);
    }

    function renderDrill6_RoofOfHouse(t) {
        drawFloor(GROUND_Y);
        clearErrorZones();

        const phase = t < 10000 ? 0 : (t < 19000 ? 1 : 2);
        const fencerX = 400;
        let torsoIncline = 0;
        let pelvisCounterShift = 0;

        if (phase === 0) {
            torsoIncline = 1.6;
            pelvisCounterShift = -4;
            registerErrorZone('d6_torso_forward', fencerX + 18, 204, 26, () => {
                effectiveElapsed = 10005;
            }, "ताठ हो");
        } else if (phase === 1) {
            torsoIncline = -1.4;
            pelvisCounterShift = 3;
            registerErrorZone('d6_torso_back', fencerX - 18, 204, 26, () => {
                effectiveElapsed = 19005;
            }, "पुढे ये");
        } else {
            torsoIncline = 0;
            pelvisCounterShift = 0;
        }

        drawHouseRoofOverlay(fencerX, GROUND_Y);
        drawU10Fencer({
            pelvisX: fencerX + pelvisCounterShift, pelvisY: 254,
            frontFootX: fencerX + 24, frontFootY: GROUND_Y,
            rearFootX: fencerX - 24, rearFootY: GROUND_Y,
            rearFootTurned90: true,
            torsoIncline: torsoIncline,
            isError: phase !== 2
        });
    }

    function renderDrill7_LungeEngine(t) {
        drawFloor(GROUND_Y);
        clearErrorZones();

        const rearAnchorX = 250;
        const baseStance = 48;
        const maxLungeReach = 64;
        const targetDummyX = 472;
        const targetDummyY = 224;

        drawFencingTargetDummy(targetDummyX, GROUND_Y, targetDummyY);

        const p = (t % 15000) / 15000;
        let lungeP = 0;
        let armP = 0;
        let rearInstepAngle = 0;

        if (p < 0.25) {
            lungeP = 0;
            armP = 0;
            dummyHitInCycle = false;
        } else if (p < 0.65) {
            const subP = (p - 0.25) / 0.4;
            if (subP < 0.25) {
                armP = subP / 0.25;
                lungeP = 0;
            } else {
                armP = 1.0;
                const legP = (subP - 0.25) / 0.75;
                lungeP = Math.min(1, Math.pow(legP, 1.35) * 1.35);
                if (legP < 0.08) triggerLaunchDust(rearAnchorX, GROUND_Y);
            }

            if (lungeP > 0.35) {
                rearInstepAngle = Math.min(12, (lungeP - 0.35) * 18.5);
            }
        } else {
            const subP = (p - 0.65) / 0.35;
            lungeP = 1 - subP;
            armP = Math.max(0, 1 - subP * 1.4);
            rearInstepAngle = Math.max(0, 12 * (1 - subP * 2));
        }

        const impactDip = (lungeP > 0.9 && lungeP < 0.98) ? 3.0 : 0;
        const pelvisDrop = (Math.pow(lungeP, 2.5) * 16) + impactDip;
        const pelvisY = 252 + pelvisDrop;
        const pelvisX = rearAnchorX + 24 + (lungeP * 40);

        const frontFootX = rearAnchorX + baseStance + (lungeP * maxLungeReach);
        let frontTilt = 0, frontFootY = GROUND_Y;
        if (lungeP > 0.15 && lungeP < 0.85) {
            frontTilt = -24;
            frontFootY = GROUND_Y - (5.0 * Math.sin((lungeP - 0.15) / 0.7 * Math.PI));
        }

        const shoulderX = pelvisX + 3 + ((lungeP * 0.08) * 10);
        const fShoulderX = shoulderX + 7;
        const currentReach = 24 + (armP * 20);
        const handX = fShoulderX + currentReach;
        const bladeAngle = -2.5;
        const rad = (bladeAngle * Math.PI) / 180;
        const bladeLen = 104;
        const actualTipX = handX + Math.cos(rad) * bladeLen;

        const isPhysicalContact = (actualTipX >= targetDummyX) && (p >= 0.25 && p < 0.65);

        if (isPhysicalContact) {
            if (!dummyHitInCycle) {
                dummyHitInCycle = true;
                playHarmonicChime();
                triggerHitStop(70, 4.0);
                createParticleBurst(targetDummyX, targetDummyY, '#22c55e', 22);
            }
        }

        drawU10Fencer({
            pelvisX, pelvisY,
            frontFootX, frontFootY,
            frontTilt: frontTilt,
            rearFootX: rearAnchorX, rearFootY: GROUND_Y,
            rearFootTurned90: true,
            rearFootInstepRoll: rearInstepAngle,
            torsoIncline: lungeP * 0.08,
            armState: 'lunge', armExtension: armP,
            bladeAngle: bladeAngle,
            rearArmActiveLunge: lungeP,
            targetSurfaceX: isPhysicalContact ? targetDummyX : 0,
            targetSurfaceY: targetDummyY,
            gazeTargetX: targetDummyX,
            gazeTargetY: targetDummyY
        });

        if (lungeP > 0.85) {
            ctx.save();
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(frontFootX, 260); ctx.lineTo(frontFootX, GROUND_Y); ctx.stroke();
            ctx.fillStyle = '#22c55e'; ctx.font = 'bold 13px "Mukta", sans-serif';
            ctx.fillText("९०° अचूक कोन", frontFootX - 24, 256);
            ctx.restore();
        }
    }

    // -------------------------------------------------------------
    // STOPWATCH & SYNCHRONIZATION
    // -------------------------------------------------------------
    function updateDrillStateMachine(currentTimeMs) {
        const config = drillTimelineConfigs[currentDrill];
        if (!config) return;

        let targetPhase = config.phases[0];
        for (let i = config.phases.length - 1; i >= 0; i--) {
            if (currentTimeMs >= config.phases[i].startTime) {
                targetPhase = config.phases[i];
                break;
            }
        }

        if (currentSubPhase !== targetPhase.subPhase) {
            currentSubPhase = targetPhase.subPhase;

            if (badgeText) {
                badgeText.innerText = `Drill #2 (${currentDrill + 1}/${TOTAL_SUB_DRILLS})`;
            }

            if (statusBox) {
                statusBox.innerText = getPersonalized(targetPhase.status);
                statusBox.style.color = targetPhase.color;
            }

            speakCoachingCue(targetPhase.marathiText);
        }

        const remainingSec = Math.max(0, Math.ceil((DRILL_DURATION - currentTimeMs) / 1000));
        if (timerNumber) {
            timerNumber.innerText = `${remainingSec}s`;
        }
        if (timerProgress) {
            const pct = Math.min(100, (currentTimeMs / DRILL_DURATION) * 100);
            timerProgress.setAttribute('stroke-dashoffset', 100 - pct);
        }
    }

    // -------------------------------------------------------------
    // ANIMATION LOOP
    // -------------------------------------------------------------
    function render() {
        const now = performance.now();
        const dt = now - lastFrameTime;
        lastFrameTime = now;

        if (now >= hitStopUntil && !isPaused) {
            const activeRate = isSlowMoHold ? 0.25 : currentPlaybackSpeed;
            effectiveElapsed += dt * activeRate;

            if (effectiveElapsed >= DRILL_DURATION) {
                effectiveElapsed = 0;
                currentDrill = (currentDrill + 1) % TOTAL_SUB_DRILLS;
                currentSubPhase = -1;
                dummyHitInCycle = false;
            }

            updateDrillStateMachine(effectiveElapsed);
        }

        // Metronome cadence for drills 2 (Escalator) & 4 (Step Roll)
        if ((currentDrill === 2 || currentDrill === 4) && !isPaused && audioUnlocked) {
            const currentSecond = Math.floor((effectiveElapsed % DRILL_DURATION) / 1000);
            if (currentSecond !== lastBeatSecond) {
                lastBeatSecond = currentSecond;
                playMetronomeTick();
            }
        }

        ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        applyCameraTransform();

        if (currentDrill === 0) renderDrill1_FootAngles(effectiveElapsed);
        else if (currentDrill === 1) renderDrill2_TinManVsCar(effectiveElapsed);
        else if (currentDrill === 2) renderDrill3_EscalatorGlide(effectiveElapsed);
        else if (currentDrill === 3) renderDrill4_RubberBand(effectiveElapsed);
        else if (currentDrill === 4) renderDrill5_StepRoll(effectiveElapsed);
        else if (currentDrill === 5) renderDrill6_RoofOfHouse(effectiveElapsed);
        else if (currentDrill === 6) renderDrill7_LungeEngine(effectiveElapsed);

        drawActiveErrorReticles();
        updateAndDrawEffects();
        updateAndDrawRipples();
        restoreCameraTransform();

        const activeSpeed = isSlowMoHold ? 0.25 : currentPlaybackSpeed;
        if (activeSpeed !== 1.0) {
            ctx.save();
            ctx.fillStyle = activeSpeed < 1.0 ? '#f59e0b' : '#38bdf8';
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(activeSpeed < 1.0 ? "🐢 ०.२५x स्लो-मोशन" : "⚡ २.५x जलद फॉरवर्ड", BASE_WIDTH - 24, 28);
            ctx.restore();
        }

        requestAnimationFrame(render);
    }

    render();

    // -------------------------------------------------------------
    // EXPORTED MASTER SHELL INTERFACE
    // -------------------------------------------------------------
    window.RivaCartridge = {
        id: 2,
        title: "Drill #2",
        subDrills: SUB_DRILL_TITLES,
        init: () => {
            initAudio();
            isPaused = false;
            effectiveElapsed = 0;
            currentDrill = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            dummyHitInCycle = false;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        restart: () => {
            stopAllSpeech();
            initAudio();
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            dummyHitInCycle = false;
            lastFrameTime = performance.now();
            isPaused = false;
            updateDrillStateMachine(0);
        },
        togglePause: () => {
            initAudio();
            isPaused = !isPaused;
            if (isPaused) stopAllSpeech();
            else lastFrameTime = performance.now();
            return isPaused;
        },
        stop: () => {
            isPaused = true;
            stopAllSpeech();
        },
        switchSubDrill: (idx) => {
            stopAllSpeech();
            currentDrill = Math.max(0, Math.min(TOTAL_SUB_DRILLS - 1, idx));
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            dummyHitInCycle = false;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        nextSubDrill: () => {
            stopAllSpeech();
            currentDrill = (currentDrill + 1) % TOTAL_SUB_DRILLS;
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            dummyHitInCycle = false;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        prevSubDrill: () => {
            stopAllSpeech();
            currentDrill = (currentDrill - 1 + TOTAL_SUB_DRILLS) % TOTAL_SUB_DRILLS;
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            dummyHitInCycle = false;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        setSpeed: (multiplier) => {
            currentPlaybackSpeed = multiplier;
        },
        toggleAudio: () => {
            isMuted = !isMuted;
            if (isMuted) stopAllSpeech();
            return isMuted;
        }
    };
})();
