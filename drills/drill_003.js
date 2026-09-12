/**
 * Riva Fencer - Cartridge 003
 * Ported from Riva Drill 3.html (10 Sub-Drills)[cite: 2]
 * Kinetic Decoupling, Horizontal Translation, Bi-directional Stepping, and Forte-Foible Riposte.[cite: 2]
 */
(function () {
    const canvas = document.getElementById('fencingCanvas');
    const ctx = canvas.getContext('2d');
    const statusBox = document.getElementById('status-box');
    const badgeText = document.getElementById('drillHeaderBadgeText');
    const timerNumber = document.getElementById('timer-number');
    const timerProgress = document.getElementById('timerProgress');

    const BASE_WIDTH = 860;
    const BASE_HEIGHT = 420;
    const GROUND_Y = 312;
    const DRILL_DURATION = 25000;
    const TOTAL_SUB_DRILLS = 10;

    const SUB_DRILL_TITLES = [
        "१. ९०° पाय व दिशा",
        "२. कोपर क्लिअरन्स",
        "३. सपाट पातळी ग्लाइड",
        "४. बोटांची अचूक पकड",
        "५. पाऊल क्रम",
        "६. डिस्टन्स मॅनेजमेंट",
        "७. बॅक-फूट ब्रेक",
        "८. रॉकेट लंज",
        "९. लंज रिकव्हरी",
        "१०. फॉर्टे पॅरी व रिपोस्ट"
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
    // 1. SPATIAL RAYCASTING & RETICLE HIT-TESTING ENGINE
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
        playCleanTone(220, 0.2);
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
                playCleanTone(880, 0.25);
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

    function playCleanTone(freq, duration, gainLevel = 0.2) {
        if (!audioCtx || isMuted) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const now = audioCtx.currentTime;
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(gainLevel, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + duration);
        } catch(e) {}
    }

    function playSteelClack() {
        if (!audioCtx || isMuted) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const now = audioCtx.currentTime;
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(2400, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.08);
        } catch(e) {}
    }

    function playClapSound() {
        if (!audioCtx || isMuted) return;
        try {
            const bufferSize = audioCtx.sampleRate * 0.06;
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
            }
            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1200;
            noise.connect(filter);
            filter.connect(audioCtx.destination);
            noise.start();
        } catch(e) {}
    }

    // -------------------------------------------------------------
    // 3. SANITIZED MARATHI TTS ENGINE
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
            .replace(/[➔➡️⬅️⚡💡🐢⭐⏱️🔊⏸️🚀🤺📐🦶🦵🏠🛗🪢🤖🏎️💥🎈🔄❌✅🛑📏🖐️•]/g, '')
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
    // 5. TIMELINE CONFIGURATIONS (10 SUB-DRILLS)[cite: 2]
    // -------------------------------------------------------------
    const drillTimelineConfigs = [
        {
            drillId: 0,
            title: "⚡ १. ९०° काटकोन पाय व दिशा बदल (Braking & Impulse)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "अगं रीवा, दोन्ही पाय समांतर ठेवू नकोस! तोल जाईल. मागच्या पायावर टॅप करून काटकोन कर.", status: "❌ अरेरे! दोन्ही पाय समांतर ठेवल्यास अचानक मागे वळताना तोल जातो! (पायांवर टॅप कर)", color: "#ef4444" },
                { startTime: 12500, subPhase: 1, marathiText: "शाब्बास रीवा! मागचा पाय भक्कम भिंतीसारखा रोवला आहेस, असाच तोल सांभाळ!", status: "✅ मागचा पाय ९०° काटकोनात भक्कम; टाळी वाजताच विजेसारखी मागे फिर!", color: "#22c55e" }
            ]
        },
        {
            drillId: 1,
            title: "🎯 २. कोपर व खांदा क्लिअरन्स (Kinetic Decoupling)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "कोपर पोटाला चिकटवू नकोस रीवा! मनगट आखडतं. कोपर बरगडीपासून दहा ते पंधरा सेंटीमीटर लांब ठेव.", status: "❌ कोपर बरगडीला घट्ट चिकटवू नकोस! मनगट आखडते. (कोपरावर टॅप कर)", color: "#ef4444" },
                { startTime: 12500, subPhase: 1, marathiText: "एकदम छान रीवा! कोपर मोकळं ठेवलंस की तलवार बोटांच्या तालावर नाचते!", status: "✅ कोपर आणि बरगडीत १०-१५ सेमी अंतर; मनगट व बोटे पूर्ण मोकळी!", color: "#22c55e" }
            ]
        },
        {
            drillId: 2,
            title: "🏎️ ३. क्षितिजसमांतर ग्लाइड (Horizontal CoM Translation)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "अगं रीवा, उड्या नको मारूस! हवेत असताना दिशा बदलता येत नाही. गुडघे वाकवून छताखाली सपाट सरक.", status: "❌ वर-खाली उड्या मारू नकोस, डोकं छताला आपटेल! (डोक्यावर टॅप कर)", color: "#ef4444" },
                { startTime: 12500, subPhase: 1, marathiText: "सुंदर रीवा! अगदी एस्केलेटरसारखी सपाट आणि गुळगुळीत चाललीस!", status: "✅ गुडघे वाकवून क्षितिजसमांतर सरक; डोके व कंबर एका सपाट पातळीत!", color: "#22c55e" }
            ]
        },
        {
            drillId: 3,
            title: "🖐️ ४. बोटांची अचूक पकड (Distal Phalanx Control)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "अगं रीवा, मुठीत जास्त ताण नको ठेवू! अंगठा आणि पहिल्या बोटाने तलवारीचं टोक हळुवार फिरव.", status: "❌ हातोडीसारखी घट्ट मूठ पकडू नकोस! टोक भरकटते. (मुठीवर टॅप कर)", color: "#ef4444" },
                { startTime: 12500, subPhase: 1, marathiText: "मस्त रीवा! अंगठा आणि तर्जनी दिशा दाखवतील, बाकीची बोटं फक्त आधार देतील!", status: "✅ अंगठा व तर्जनीच्या टोकांनी दिशा दे; उरलेली बोटे हलकी टेकव!", color: "#22c55e" }
            ]
        },
        {
            drillId: 4,
            title: "🦶 ५. पाऊल क्रम (Calcaneus Dorsiflexion)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "सूक्ष्म पाऊल रीवा, आधी टाच टेकवून तोल तपास.", status: "१. सूक्ष्म पाऊल: पुढचे बोट वर उचलून आधी टाच टेकव!", color: "#38bdf8" },
                { startTime: 8250, subPhase: 1, marathiText: "मध्यम पाऊल, पायांमधील अंतर कायम ठेव.", status: "२. मध्यम पाऊल: लयबद्ध, सुरक्षित आणि समतोल चाल!", color: "#facc15" },
                { startTime: 16500, subPhase: 2, marathiText: "मोठं पाऊल टाक रीवा, पण खांदे मुळीच हलवू नकोस!", status: "३. मोठे पाऊल: वेगाने अंतर तोड; खांदे आणि हात शांत ठेव!", color: "#4ade80" }
            ]
        },
        {
            drillId: 5,
            title: "📏 ६. डिस्टन्स मॅनेजमेंट (Critical Distance)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "लक्ष दे रीवा! प्रतिस्पर्धी जवळ आला की लगेच मागे सरक. दोन मीटरचं सुरक्षित अंतर तुटू देऊ नकोस.", status: "❌ प्रतिस्पर्धी पुढे आला पण तू अंतर राखले नाहीस! (पायांवर टॅप कर)", color: "#ef4444" },
                { startTime: 12500, subPhase: 1, marathiText: "शाब्बास रीवा! प्रतिस्पर्ध्याच्या प्रत्येक पावलासोबत स्वतःचं अंतर अचूक राखत आहेस!", status: "✅ तो जितका पुढे येईल, तितकीच मागे हो! २ मीटर अंतर कायम राख.", color: "#22c55e" }
            ]
        },
        {
            drillId: 6,
            title: "🛑 ७. मागे येताना मागचा पाय आधी (Rapid Deceleration)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "मागे जाताना आधी मागचा पाय चवड्यावर टेकव.", status: "१. मागे येताना आधी मागचा पाय टेकव (चवडा ➔ टाच)!", color: "#38bdf8" },
                { startTime: 12500, subPhase: 1, marathiText: "प्रतिस्पर्धी थांबला, लगेच मागच्या पायावर ब्रेक लाव रीवा!", status: "🛑 प्रतिस्पर्धी थांबताच जागेवर ब्रेक लाव! तोल १००% सुरक्षित.", color: "#22c55e" }
            ]
        },
        {
            drillId: 7,
            title: "🚀 ८. रॉकेट लंज – हात आधी (Right-of-Way) व ९०° अचूक लंज",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "लक्ष्य डमीवर रोखून धर रीवा... तीन, दोन, एक!", status: "१. ऑन-गार्द: लक्ष्य डमीवर रोखून सज्ज राहा... तीन, दोन, एक!", color: "#38bdf8" },
                { startTime: 6250, subPhase: 1, marathiText: "आधी हात सरळ कर, मग मागच्या पायाने स्फोटक धक्का दे! नव्वद अंशात लंज मार!", status: "💥 आधी हात सरळ (राईट ऑफ वे) ➔ मागच्या पायाचा धक्का ➔ ९०° अचूक लंज!", color: "#facc15" },
                { startTime: 17500, subPhase: 2, marathiText: "पुढच्या टाचेने जमिनीला ढकलून झटक्यात ऑन-गार्दवर परत ये रीवा!", status: "३. पुढच्या टाचेने जमिनीला मागे ढकल आणि ऑन-गार्दवर परत ये!", color: "#4ade80" }
            ]
        },
        {
            drillId: 8,
            title: "🔄 ९. लंजमधून झटपट रिकव्हरी व ३/४ प्रोफाइल",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "वार हुकला तर लंजमध्ये अडकून नको राहूस रीवा!", status: "१. लंज झाल्यावर वार हुकला तर तिथेच थांबणे धोकादायक आहे!", color: "#facc15" },
                { startTime: 11250, subPhase: 1, marathiText: "पुढच्या टाचेने ढकलून पटकन मागे ये!", status: "२. पुढच्या टाचेने जमिनीला धक्का दे आणि झटक्यात मागे सरक!", color: "#38bdf8" },
                { startTime: 18750, subPhase: 2, marathiText: "शाब्बास रीवा! शरीर तिरपं ठेवून टार्गेट लपव, आता तू पूर्ण सुरक्षित आहेस!", status: "३. सुरक्षित ऑन-गार्द! छाती ३/४ तिरकी ठेवून टार्गेट लहान कर.", color: "#22c55e" }
            ]
        },
        {
            drillId: 9,
            title: "🛡️ १०. आधी जागा, फॉर्टे पॅरी व थेट रिपोस्ट (Riposte)",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "प्रतिस्पर्धी येताच आधी एक पाऊल मागे घे रीवा, जागा तयार कर!", status: "पायरी १: प्रतिस्पर्धी चालून येताच १ पाऊल मागे घेऊन जागा बनव!", color: "#38bdf8" },
                { startTime: 8750, subPhase: 1, marathiText: "तुझ्या फॉर्टेने त्याचे टोक बाजूला उडवून लाव, खणकन!", status: "पायरी २: तुझ्या फॉर्टेने त्याचे कमजोर टोक खणकन बाजूला उडव!", color: "#facc15" },
                { startTime: 16250, subPhase: 2, marathiText: "आता वेळ न दवडता थेट छातीवर रिपोस्ट मार, टच!", status: "पायरी ३: रिपोस्ट! पॅरी होताच थेट प्रतिस्पर्ध्याच्या छातीवर अचूक स्पर्श!", color: "#22c55e" }
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
    let lastClapSecond = -1;
    let targetPostHitInCycle = false;
    let drill10HitInCycle = false;

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
    // 6. ANATOMICAL SKELETAL IK & ATHLETE RENDERING[cite: 2]
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

    function drawAuthenticShoe(x, y, tiltDeg, isFront, isTurned90, instepRollDeg = 0, facingLeft = false) {
        ctx.save();
        ctx.translate(x, y);
        if (facingLeft) ctx.scale(-1, 1);

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

    function drawFoilLameVest(pelvisX, pelvisY, shoulderX, shoulderY, isOpponent = false, isError = false) {
        ctx.save();
        ctx.fillStyle = isError ? '#fca5a5' : (isOpponent ? '#475569' : '#0284c7');
        ctx.strokeStyle = isError ? '#ef4444' : '#38bdf8';
        ctx.lineWidth = 1.4;

        ctx.beginPath();
        ctx.moveTo(shoulderX - (isOpponent ? -10 : 10), shoulderY + 8);
        ctx.lineTo(shoulderX + (isOpponent ? -10 : 10), shoulderY + 8);
        ctx.lineTo(pelvisX + (isOpponent ? -8 : 8), pelvisY);
        ctx.quadraticCurveTo(pelvisX, pelvisY + 5, pelvisX - (isOpponent ? -8 : 8), pelvisY);
        ctx.lineTo(shoulderX - (isOpponent ? -10 : 10), shoulderY + 8);
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

    function drawAuthenticMask(headX, headY, gazeTargetX, gazeTargetY, isOpponent = false, isError = false) {
        ctx.save();
        ctx.fillStyle = isOpponent ? '#334155' : '#0284c7';
        ctx.strokeStyle = isError ? '#ef4444' : '#64748b';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(headX - (isOpponent ? -10 : 10), headY + 8);
        ctx.quadraticCurveTo(headX + (isOpponent ? -12 : 12), headY + 16, headX + (isOpponent ? -7 : 7), headY + 22);
        ctx.lineTo(headX - (isOpponent ? -2 : 2), headY + 22);
        ctx.quadraticCurveTo(headX + (isOpponent ? -2 : 2), headY + 15, headX + (isOpponent ? -10 : 10), headY + 8);
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
        ctx.arc(headX, headY, 13, isOpponent ? Math.PI * 0.75 : Math.PI * 0.25, isOpponent ? Math.PI * 1.25 : Math.PI * 0.75);
        ctx.stroke();

        ctx.restore();
    }

    function calculateEulerBladeBuckle(handX, handY, angleDeg, targetX, targetY, isLeftFacing = false) {
        const bladeLen = 104;
        const rad = (angleDeg * Math.PI) / 180;
        const dir = isLeftFacing ? -1 : 1;
        const undeflectedTipX = handX + dir * Math.cos(rad) * bladeLen;
        const undeflectedTipY = handY + Math.sin(rad) * bladeLen;

        const hasReached = isLeftFacing ? (targetX > 0 && undeflectedTipX <= targetX) : (targetX > 0 && undeflectedTipX >= targetX);

        if (!hasReached) {
            return {
                isBent: false,
                p0: { x: handX, y: handY },
                tip: { x: undeflectedTipX, y: undeflectedTipY }
            };
        }

        const tipX = targetX;
        const tipY = targetY;
        const penetration = Math.abs(undeflectedTipX - targetX);

        const nodeX = handX + dir * (bladeLen * 0.68) * Math.cos(rad);
        const nodeY = handY + (bladeLen * 0.68) * Math.sin(rad);

        const normalAngle = rad - (Math.PI / 2);
        const buckleDepth = 10.0 + (penetration * 0.82);

        const ctrlX = nodeX + dir * Math.cos(normalAngle) * buckleDepth;
        const ctrlY = nodeY + Math.sin(normalAngle) * buckleDepth;

        return {
            isBent: true,
            p0: { x: handX, y: handY },
            pCtrl: { x: ctrlX, y: ctrlY },
            tip: { x: tipX, y: tipY }
        };
    }

    function drawRealisticFoil(handX, handY, angleDeg, targetX, targetY, isOpponent = false) {
        const rad = (angleDeg * Math.PI) / 180;

        ctx.save();
        ctx.translate(handX, handY);
        ctx.rotate(isOpponent ? -rad : rad);
        if (isOpponent) ctx.scale(-1, 1);
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

        const spine = calculateEulerBladeBuckle(handX, handY, angleDeg, targetX, targetY, isOpponent);

        ctx.save();
        ctx.lineCap = 'round';

        if (spine.isBent) {
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(spine.p0.x, spine.p0.y);
            ctx.quadraticCurveTo(spine.pCtrl.x, spine.pCtrl.y, spine.tip.x, spine.tip.y);
            ctx.stroke();

            drawElectronicPointGlow(spine.tip.x, spine.tip.y);
        } else {
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

    function drawSteelClashSparks(x, y) {
        ctx.save();
        const grad = ctx.createRadialGradient(x, y, 1, x, y, 8);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.5, '#38bdf8');
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 4; i++) {
            const ang = (Math.PI / 2) * i + 0.35;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(ang) * 9, y + Math.sin(ang) * 9);
            ctx.stroke();
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

    function drawCompetitionStrip(groundY) {
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

    function drawRegulationTargetPost(x, groundY, targetY) {
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
        ctx.fillText("डमी पोस्ट 🎯", x - 22, targetY + 52);
        ctx.restore();
    }

    function drawBiomechanicalFencer(cfg) {
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
            isOpponent = false,
            isError = false,
            rearArmActiveLunge = 0,
            gazeTargetX = 0,
            gazeTargetY = 0,
            label = ""
        } = cfg;

        const femur = 46;
        const tibia = 43;

        const rearHipX = pelvisX + (isOpponent ? 5 : -5);
        const rearHipY = pelvisY;
        const rearAnkleY = rearFootY - 6;
        const rearIK = solveLegIK(rearHipX, rearHipY, rearFootX, rearAnkleY, femur, tibia, isOpponent);
        drawAnatomicalContouredLeg(rearHipX, rearHipY, rearIK.kx, rearIK.ky, rearFootX, rearAnkleY, false);
        drawAuthenticShoe(rearFootX, rearFootY, rearTilt, false, rearFootTurned90, rearFootInstepRoll, isOpponent);

        const frontHipX = pelvisX + (isOpponent ? -5 : 5);
        const frontHipY = pelvisY;
        const frontAnkleY = frontFootY - 6;
        const frontIK = solveLegIK(frontHipX, frontHipY, frontFootX, frontAnkleY, femur, tibia, !isOpponent);
        drawAnatomicalContouredLeg(frontHipX, frontHipY, frontIK.kx, frontIK.ky, frontFootX, frontAnkleY, true);
        drawAuthenticShoe(frontFootX, frontFootY, frontTilt, true, frontFootTurned, 0, isOpponent);

        const shoulderX = pelvisX + (isOpponent ? -3 : 3) + (isOpponent ? -torsoIncline * 10 : torsoIncline * 10);
        const shoulderY = pelvisY - 50;

        ctx.save();
        ctx.fillStyle = isError ? '#fca5a5' : '#f1f5f9';
        ctx.beginPath();
        ctx.roundRect(pelvisX - 9, pelvisY - 4, 18, 9, [2, 2, 3, 3]);
        ctx.fill();
        ctx.restore();

        drawFoilLameVest(pelvisX, pelvisY, shoulderX, shoulderY, isOpponent, isError);

        const bShoulderX = shoulderX + (isOpponent ? 7 : -7);
        const bShoulderY = shoulderY + 8;
        ctx.save();
        ctx.strokeStyle = isOpponent ? '#64748b' : '#cbd5e1'; ctx.lineWidth = 3.6; ctx.lineCap = 'round';

        if (rearArmActiveLunge > 0) {
            const snap = rearArmActiveLunge;
            const bElbowX = isOpponent ? ((1 - snap) * (bShoulderX + 12) + snap * (bShoulderX + 24)) : ((1 - snap) * (bShoulderX - 12) + snap * (bShoulderX - 24));
            const bElbowY = (1 - snap) * (bShoulderY - 12) + snap * (bShoulderY + 8);
            const bHandX = isOpponent ? ((1 - snap) * (bElbowX - 4) + snap * (bShoulderX + 42)) : ((1 - snap) * (bElbowX + 4) + snap * (bShoulderX - 42));
            const bHandY = (1 - snap) * (bElbowY - 12) + snap * (bShoulderY + 18);

            ctx.beginPath(); ctx.moveTo(bShoulderX, bShoulderY);
            ctx.lineTo(bElbowX, bElbowY); ctx.lineTo(bHandX, bHandY); ctx.stroke();
        } else {
            const bElbowX = isOpponent ? (bShoulderX + 12) : (bShoulderX - 12);
            const bElbowY = bShoulderY - 12;
            const bHandX = isOpponent ? (bElbowX - 4) : (bElbowX + 4);
            const bHandY = bElbowY - 12;

            ctx.beginPath(); ctx.moveTo(bShoulderX, bShoulderY);
            ctx.lineTo(bElbowX, bElbowY); ctx.lineTo(bHandX, bHandY); ctx.stroke();
        }
        ctx.restore();

        const headX = shoulderX + (isOpponent ? -3 : 3);
        const headY = shoulderY - 18;
        drawAuthenticMask(headX, headY, gazeTargetX, gazeTargetY, isOpponent, isError);

        if (label) {
            ctx.save();
            ctx.fillStyle = isError ? '#ef4444' : '#22c55e';
            ctx.font = 'bold 14px "Mukta", sans-serif';
            ctx.fillText(label, headX - 35, headY - 22);
            ctx.restore();
        }

        const fShoulderX = shoulderX + (isOpponent ? -7 : 7);
        const fShoulderY = shoulderY + 10;

        let handX, handY;
        ctx.save();
        ctx.strokeStyle = isOpponent ? '#64748b' : '#f8fafc'; ctx.lineWidth = 3.8; ctx.lineCap = 'round';

        if (armState === 'enGarde') {
            handX = fShoulderX + (isOpponent ? -24 : 24);
            handY = fShoulderY + 2;
            const elbowX = fShoulderX + (isOpponent ? -12 : 12);
            const elbowY = fShoulderY + 12;

            ctx.beginPath(); ctx.moveTo(fShoulderX, fShoulderY);
            ctx.lineTo(elbowX, elbowY); ctx.lineTo(handX, handY); ctx.stroke();
            ctx.restore();
            drawRealisticFoil(handX, handY, bladeAngle, 0, 0, isOpponent);
        } else {
            const maxReach = 44;
            const currentReach = 24 + (armExtension * (maxReach - 24));
            handX = fShoulderX + (isOpponent ? -currentReach : currentReach);
            handY = fShoulderY - (armExtension * 3.0);
            const elbowX = fShoulderX + (isOpponent ? -(currentReach * 0.52) : (currentReach * 0.52));
            const elbowY = fShoulderY + (12 * (1 - armExtension));

            ctx.beginPath(); ctx.moveTo(fShoulderX, fShoulderY);
            ctx.lineTo(elbowX, elbowY); ctx.lineTo(handX, handY); ctx.stroke();
            ctx.restore();
            drawRealisticFoil(handX, handY, bladeAngle, targetSurfaceX, targetSurfaceY, isOpponent);
        }
    }

    // -------------------------------------------------------------
    // BI-DIRECTIONAL STEPPING ENGINE
    // -------------------------------------------------------------
    function getStepKinematics(startX, baseStance, stepDist, p, isAdvancing) {
        let frontX, backX, frontTilt = 0, rearTilt = 0, frontFootY = GROUND_Y, rearFootY = GROUND_Y;
        let pelvisOffset = 0;

        if (isAdvancing) {
            if (p < 0.5) {
                const subP = p / 0.5;
                backX = startX - baseStance / 2;
                frontX = startX + baseStance / 2 + (subP * stepDist);
                if (subP < 0.8) {
                    frontTilt = -18;
                    frontFootY = GROUND_Y - (4.5 * Math.sin((subP / 0.8) * Math.PI));
                } else {
                    const landP = (subP - 0.8) / 0.2;
                    frontTilt = -18 * (1 - landP);
                    frontFootY = GROUND_Y;
                }
                pelvisOffset = (subP * stepDist * 0.5);
            } else {
                const subP = (p - 0.5) / 0.5;
                frontX = startX + baseStance / 2 + stepDist;
                backX = startX - baseStance / 2 + (subP * stepDist);
                rearTilt = 12 * Math.sin(subP * Math.PI);
                rearFootY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) + (subP * stepDist * 0.5);
            }
        } else {
            if (p < 0.5) {
                const subP = p / 0.5;
                frontX = startX + baseStance / 2;
                backX = startX - baseStance / 2 - (subP * stepDist);
                rearTilt = 18 * Math.sin(subP * Math.PI);
                rearFootY = GROUND_Y - (4.5 * Math.sin(subP * Math.PI));
                pelvisOffset = -(subP * stepDist * 0.5);
            } else {
                const subP = (p - 0.5) / 0.5;
                backX = startX - baseStance / 2 - stepDist;
                frontX = startX + baseStance / 2 - (subP * stepDist);
                frontTilt = -14 * Math.sin(subP * Math.PI);
                frontFootY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = -(stepDist * 0.5) - (subP * stepDist * 0.5);
            }
        }

        return {
            pelvisX: startX + pelvisOffset,
            frontFootX: frontX, frontFootY, frontTilt,
            rearFootX: backX, rearFootY, rearTilt
        };
    }

    function getOpponentStepKinematics(startX, baseStance, stepDist, p, isAdvancingTowardRiva) {
        let frontX, backX, frontTilt = 0, rearTilt = 0, frontFootY = GROUND_Y, rearFootY = GROUND_Y;
        let pelvisOffset = 0;

        const startFrontX = startX - baseStance / 2;
        const startBackX = startX + baseStance / 2;

        if (isAdvancingTowardRiva) {
            if (p < 0.5) {
                const subP = p / 0.5;
                backX = startBackX;
                frontX = startFrontX - (subP * stepDist);
                if (subP < 0.8) {
                    frontTilt = 18;
                    frontFootY = GROUND_Y - (4.5 * Math.sin((subP / 0.8) * Math.PI));
                } else {
                    const landP = (subP - 0.8) / 0.2;
                    frontTilt = 18 * (1 - landP);
                    frontFootY = GROUND_Y;
                }
                pelvisOffset = -(subP * stepDist * 0.5);
            } else {
                const subP = (p - 0.5) / 0.5;
                frontX = startFrontX - stepDist;
                backX = startBackX - (subP * stepDist);
                rearTilt = -12 * Math.sin(subP * Math.PI);
                rearFootY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = -(stepDist * 0.5) - (subP * stepDist * 0.5);
            }
        } else {
            if (p < 0.5) {
                const subP = p / 0.5;
                frontX = startFrontX;
                backX = startBackX + (subP * stepDist);
                rearTilt = -18 * Math.sin(subP * Math.PI);
                rearFootY = GROUND_Y - (4.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (subP * stepDist * 0.5);
            } else {
                const subP = (p - 0.5) / 0.5;
                backX = startBackX + stepDist;
                frontX = startFrontX + (subP * stepDist);
                frontTilt = 14 * Math.sin(subP * Math.PI);
                frontFootY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) + (subP * stepDist * 0.5);
            }
        }

        return {
            pelvisX: startX + pelvisOffset,
            frontFootX: frontX, frontFootY, frontTilt,
            rearFootX: backX, rearFootY, rearTilt
        };
    }

    function drawHUDCard(cx, cy, title, line1, line2, isGood) {
        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        ctx.strokeStyle = isGood ? '#38bdf8' : '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(cx - 120, cy - 60, 240, 120, 8); ctx.fill(); ctx.stroke();

        ctx.fillStyle = isGood ? '#38bdf8' : '#ef4444'; ctx.font = 'bold 14px "Mukta", sans-serif';
        ctx.fillText(title, cx - 55, cy - 35);

        ctx.fillStyle = '#cbd5e1'; ctx.font = '12px "Mukta", sans-serif';
        ctx.fillText("• " + line1, cx - 105, cy - 8);
        ctx.fillStyle = isGood ? '#4ade80' : '#f87171';
        ctx.fillText("• " + line2, cx - 105, cy + 18);
        ctx.restore();
    }

    // -------------------------------------------------------------
    // SUB-DRILL 1 TO 10 RENDERING ROUTINES[cite: 2]
    // -------------------------------------------------------------
    function renderDrill1_FootBaseAndImpulse(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        let phase = t < 12500 ? 0 : 1;
        let p = phase === 0 ? (t / 12500) : ((t - 12500) / 12500);

        if (phase === 0) {
            let runCycle = (p * 3) % 1;
            let isTurning = runCycle > 0.45 && runCycle < 0.65;
            let fencerX = runCycle < 0.5 ? 240 + (runCycle * 180) : 330 - ((runCycle - 0.5) * 180);

            registerErrorZone('d1_rear_foot', fencerX - 22, GROUND_Y - 8, 24, () => {
                effectiveElapsed = 12505;
            }, "काटकोन कर");

            drawBiomechanicalFencer({
                pelvisX: fencerX, pelvisY: 254,
                frontFootX: fencerX + 22, frontFootY: GROUND_Y,
                rearFootX: fencerX - 22, rearFootY: GROUND_Y,
                rearFootTurned90: false,
                isError: true, label: isTurning ? "असंतुलित" : ""
            });
            drawHUDCard(620, 130, "बायोमेकॅनिक्स ब्रेक", "समांतर पाय = घसरण व तोल जाणे", "दिशा बदलताना गती संपते", false);
        } else {
            let cycleP = (p * 2.5) % 1;
            let movingFwd = (p * 2.5) % 2 < 1;
            let k = getStepKinematics(270, 48, 38, cycleP, movingFwd);

            const curSec = Math.floor(t / 1000);
            if ((curSec === 15 || curSec === 19 || curSec === 23) && curSec !== lastClapSecond) {
                lastClapSecond = curSec;
                playClapSound();
            }

            drawBiomechanicalFencer({
                pelvisX: k.pelvisX, pelvisY: 256,
                frontFootX: k.frontFootX, frontFootY: k.frontFootY, frontTilt: k.frontTilt,
                rearFootX: k.rearFootX, rearFootY: k.rearFootY, rearTilt: k.rearTilt,
                rearFootTurned90: true,
                isError: false
            });

            ctx.save();
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.8;
            ctx.beginPath(); ctx.moveTo(k.rearFootX - 6, GROUND_Y - 14); ctx.lineTo(k.rearFootX + 6, GROUND_Y - 14); ctx.lineTo(k.rearFootX + 6, GROUND_Y); ctx.stroke();
            ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 12px "Mukta", sans-serif'; ctx.fillText("९०°", k.rearFootX - 22, GROUND_Y - 8);
            ctx.restore();

            drawHUDCard(620, 130, "९०° काटकोन रहस्य", "मागचा पाय भक्कम ब्रेक वॉल", "टाळी वाजताच मिलीसेकंदात मागे!", true);
        }
    }

    function renderDrill2_ElbowAndDecoupling(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        let phase = t < 12500 ? 0 : 1;
        const fencerX = 360;

        if (phase === 0) {
            registerErrorZone('d2_elbow_rib', fencerX + 16, 236, 24, () => {
                effectiveElapsed = 12505;
            }, "कोपर सैल कर");

            drawBiomechanicalFencer({
                pelvisX: fencerX, pelvisY: 256,
                frontFootX: fencerX + 24, frontFootY: GROUND_Y,
                rearFootX: fencerX - 24, rearFootY: GROUND_Y,
                rearFootTurned90: true,
                isError: true, label: "आखडलेला हात"
            });
            drawHUDCard(620, 130, "कोपर स्थिती 📐", "बरगडीला चिकटलेले कोपर = आखडणे", "प्रतिक्रिया वेळ मंदावतो", false);
        } else {
            drawBiomechanicalFencer({
                pelvisX: fencerX, pelvisY: 256,
                frontFootX: fencerX + 24, frontFootY: GROUND_Y,
                rearFootX: fencerX - 24, rearFootY: GROUND_Y,
                rearFootTurned90: true,
                isError: false
            });

            const elbowX = fencerX + 18, elbowY = 227;
            ctx.save();
            ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(elbowX, elbowY); ctx.lineTo(elbowX - 14, elbowY); ctx.stroke();
            ctx.fillStyle = '#38bdf8'; ctx.font = 'bold 12px "Mukta", sans-serif'; ctx.fillText("१०-१५ सेमी", elbowX - 44, elbowY - 6);
            ctx.restore();

            drawHUDCard(620, 130, "योग्य अंतर 📐", "१०-१५ सेमी क्लिअरन्स", "बोटांची विजेसारखी चपळता!", true);
        }
    }

    function renderDrill3_FlatPlaneTranslation(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        const laserCeilingY = 175;
        let phase = t < 12500 ? 0 : 1;
        let fencerX = 360;

        if (phase === 0) {
            let bob = -Math.abs(Math.sin(t * 0.012)) * 26;
            registerErrorZone('d3_bobbing', fencerX, 200 + bob, 28, () => {
                effectiveElapsed = 12505;
            }, "सपाट सरक");

            drawBiomechanicalFencer({
                pelvisX: fencerX, pelvisY: 256 + bob,
                frontFootX: fencerX + 24, frontFootY: GROUND_Y,
                rearFootX: fencerX - 24, rearFootY: GROUND_Y,
                rearFootTurned90: true,
                isError: true, label: "अस्थिर"
            });

            ctx.save();
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.0; ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(40, laserCeilingY); ctx.lineTo(480, laserCeilingY); ctx.stroke();
            ctx.restore();
            drawHUDCard(620, 130, "सपाट छत नियम 🏎️", "उड्या मारणे = हवेत अडकणे", "दिशा बदलणे अशक्य होते", false);
        } else {
            let p = (t % 8000) / 8000;
            let cycleP = (p * 2) % 1;
            let isAdv = (p * 2) < 1;
            let k = getStepKinematics(340, 48, 38, cycleP, isAdv);

            drawBiomechanicalFencer({
                pelvisX: k.pelvisX, pelvisY: 256,
                frontFootX: k.frontFootX, frontFootY: k.frontFootY, frontTilt: k.frontTilt,
                rearFootX: k.rearFootX, rearFootY: k.rearFootY, rearTilt: k.rearTilt,
                rearFootTurned90: true,
                isError: false
            });

            ctx.save();
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2.0; ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(40, laserCeilingY); ctx.lineTo(480, laserCeilingY); ctx.stroke();
            ctx.fillStyle = '#22c55e'; ctx.font = 'bold 12px "Mukta", sans-serif';
            ctx.fillText("क्षितिजसमांतर पातळी (Zero Oscillation)", 60, laserCeilingY - 8);
            ctx.restore();

            drawHUDCard(620, 130, "सपाट छत नियम 🏎️", "गुडघे वाकलेले = स्प्रिंग सज्ज", "सपाट पातळी = कमाल वेग", true);
        }
    }

    function renderDrill4_DistalPhalanxGrip(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        let phase = t < 12500 ? 0 : 1;
        const cx = 310, cy = 200;

        if (phase === 0) {
            registerErrorZone('d4_grip', cx, cy, 32, () => {
                effectiveElapsed = 12505;
            }, "पकड सैल कर");

            drawHUDCard(620, 130, "पकड बायोमेकॅनिक्स 🖐️", "घट्ट मूठ = आखडलेले मनगट", "पॉईंट नियंत्रण अशक्य", false);
        } else {
            drawHUDCard(620, 130, "पकड बायोमेकॅनिक्स 🖐️", "अंगठा व तर्जनी = दिशा दर्शक", "उरलेली बोटे = संतुलित आधार", true);
        }

        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        ctx.strokeStyle = phase === 0 ? '#ef4444' : '#38bdf8';
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.roundRect(cx - 130, cy - 85, 260, 170, 10); ctx.fill(); ctx.stroke();

        ctx.fillStyle = phase === 0 ? '#ef4444' : '#38bdf8'; ctx.font = 'bold 14px "Mukta", sans-serif';
        ctx.fillText(phase === 0 ? "हातोडी पकड (Hyper-Tension)" : "फिंगरटिप नियंत्रण (Precision Grip)", cx - 110, cy - 58);

        ctx.fillStyle = '#64748b'; ctx.fillRect(cx - 50, cy - 8, 100, 16);
        ctx.fillStyle = '#94a3b8'; ctx.fillRect(cx + 45, cy - 24, 6, 48);

        if (phase === 0) {
            ctx.fillStyle = '#dc2626';
            ctx.beginPath(); ctx.roundRect(cx - 40, cy - 22, 75, 44, 8); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 12px "Mukta", sans-serif';
            ctx.fillText("अति-ताण: सर्व बोटे आखडली", cx - 55, cy + 45);
        } else {
            ctx.fillStyle = '#22c55e';
            ctx.beginPath(); ctx.roundRect(cx - 30, cy - 26, 32, 14, 4); ctx.fill();
            ctx.fillStyle = '#0f172a'; ctx.font = 'bold 10px "Mukta", sans-serif'; ctx.fillText("अंगठा", cx - 22, cy - 16);

            ctx.fillStyle = '#22c55e';
            ctx.beginPath(); ctx.roundRect(cx - 30, cy + 12, 32, 14, 4); ctx.fill();
            ctx.fillStyle = '#0f172a'; ctx.font = 'bold 10px "Mukta", sans-serif'; ctx.fillText("तर्जनी", cx - 22, cy + 22);

            ctx.fillStyle = '#4ade80'; ctx.font = '12px "Mukta", sans-serif';
            ctx.fillText("सूक्ष्म बोटांचे नियंत्रण = १००% अचूकता", cx - 80, cy + 54);
        }
        ctx.restore();
    }

    function renderDrill5_HeelToeStride(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        let p = (t % 15000) / 15000;
        let gear = p < 0.33 ? 1 : (p < 0.66 ? 2 : 3);
        let stepSize = gear === 1 ? 22 : (gear === 2 ? 40 : 64);

        let subP = gear === 1 ? (p / 0.33) : (gear === 2 ? (p - 0.33) / 0.33 : (p - 0.66) / 0.34);
        let cycle = (subP * 2) % 1;
        let isAdv = (subP * 2) < 1;

        let k = getStepKinematics(270, 48, stepSize, cycle, isAdv);

        drawBiomechanicalFencer({
            pelvisX: k.pelvisX, pelvisY: 256,
            frontFootX: k.frontFootX, frontFootY: k.frontFootY, frontTilt: k.frontTilt,
            rearFootX: k.rearFootX, rearFootY: k.rearFootY, rearTilt: k.rearTilt,
            rearFootTurned90: true
        });

        drawHUDCard(620, 130, "पाऊल क्रम नियम 🦶", "१. बोटे उचलून आधी टाच टेकव", "२. खांदे व हात पूर्ण शांत ठेव", true);
    }

    function renderDrill6_SpatialDistanceManagement(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        let phase = t < 12500 ? 0 : 1;
        let p = phase === 0 ? (t / 12500) : ((t - 12500) / 12500);
        let cycle = (p * 2) % 1;
        let isOppAdv = (p * 2) < 1;

        let oppK = getOpponentStepKinematics(580, 48, 42, cycle, isOppAdv);
        let rivaK;
        let isDistanceSafe = true;

        if (phase === 0) {
            rivaK = getStepKinematics(230, 48, 12, cycle, !isOppAdv);
            isDistanceSafe = (oppK.pelvisX - rivaK.pelvisX) > 280;
            registerErrorZone('d6_distance', rivaK.pelvisX, 256, 26, () => {
                effectiveElapsed = 12505;
            }, "मागे हो");
        } else {
            rivaK = getStepKinematics(230, 48, 42, cycle, !isOppAdv);
            isDistanceSafe = true;
        }

        const midX = (rivaK.frontFootX + oppK.frontFootX) / 2;
        ctx.save();
        ctx.strokeStyle = isDistanceSafe ? '#38bdf8' : '#ef4444';
        ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(rivaK.frontFootX, 220); ctx.lineTo(oppK.frontFootX, 220); ctx.stroke();
        ctx.fillStyle = isDistanceSafe ? '#38bdf8' : '#ef4444'; ctx.font = 'bold 12px "Mukta", sans-serif';
        ctx.fillText(isDistanceSafe ? "सुरक्षित अंतर (Safe Distance)" : "धोकादायक अंतर (Distance Collapsed)", midX - 70, 212);
        ctx.restore();

        drawBiomechanicalFencer({
            pelvisX: rivaK.pelvisX, pelvisY: 256,
            frontFootX: rivaK.frontFootX, frontFootY: rivaK.frontFootY, frontTilt: rivaK.frontTilt,
            rearFootX: rivaK.rearFootX, rearFootY: rivaK.rearFootY, rearTilt: rivaK.rearTilt,
            rearFootTurned90: true
        });

        drawBiomechanicalFencer({
            pelvisX: oppK.pelvisX, pelvisY: 256,
            frontFootX: oppK.frontFootX, frontFootY: oppK.frontFootY, frontTilt: oppK.frontTilt,
            rearFootX: oppK.rearFootX, rearFootY: oppK.rearFootY, rearTilt: oppK.rearTilt,
            rearFootTurned90: true,
            isOpponent: true,
            bladeAngle: -4
        });

        drawHUDCard(620, 130, "डिस्टन्स नियम 📏", "तो १ पाऊल पुढे = तू १ पाऊल मागे", "२ मीटर अंतर कधीही सोडू नकोस", isDistanceSafe);
    }

    function renderDrill7_RetreatBraking(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        let p = (t % 10000) / 10000;
        let attackerHalts = p > 0.55;

        let k;
        if (!attackerHalts) {
            let stepP = (p / 0.55);
            k = getStepKinematics(260, 48, 38, stepP, false);
        } else {
            k = {
                pelvisX: 222,
                frontFootX: 246, frontFootY: GROUND_Y, frontTilt: 0,
                rearFootX: 198, rearFootY: GROUND_Y, rearTilt: 0
            };
        }

        drawBiomechanicalFencer({
            pelvisX: k.pelvisX, pelvisY: 256,
            frontFootX: k.frontFootX, frontFootY: k.frontFootY, frontTilt: k.frontTilt,
            rearFootX: k.rearFootX, rearFootY: k.rearFootY, rearTilt: k.rearTilt,
            rearFootTurned90: true
        });

        let oppK;
        if (!attackerHalts) {
            let oppStepP = p / 0.55;
            oppK = getOpponentStepKinematics(560, 48, 40, oppStepP, true);
        } else {
            oppK = {
                pelvisX: 520,
                frontFootX: 496, frontFootY: GROUND_Y, frontTilt: 0,
                rearFootX: 544, rearFootY: GROUND_Y, rearTilt: 0
            };
        }

        drawBiomechanicalFencer({
            pelvisX: oppK.pelvisX, pelvisY: 256,
            frontFootX: oppK.frontFootX, frontFootY: oppK.frontFootY, frontTilt: oppK.frontTilt,
            rearFootX: oppK.rearFootX, rearFootY: oppK.rearFootY, rearTilt: oppK.rearTilt,
            rearFootTurned90: true,
            isOpponent: true,
            bladeAngle: -4
        });

        drawHUDCard(620, 130, "बॅक-फूट ब्रेक 🛑", "मागचा पाय आधी टेकल्याने", "त्वरित अचूक ब्रेक लागतो!", true);
    }

    function renderDrill8_RocketLungeRoW(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        const rearAnchorX = 240;
        const baseStance = 48;
        const maxLungeReach = 64;
        const targetPostX = 462;
        const targetY = 226;

        drawRegulationTargetPost(targetPostX, GROUND_Y, targetY);

        let p = (t % 12500) / 12500;
        let lungeP = 0, armP = 0, rearInstepAngle = 0;

        if (p < 0.25) {
            lungeP = 0; armP = 0;
            targetPostHitInCycle = false;
        } else if (p < 0.65) {
            let subP = (p - 0.25) / 0.4;
            if (subP < 0.25) {
                armP = subP / 0.25;
                lungeP = 0;
            } else {
                armP = 1.0;
                const legP = (subP - 0.25) / 0.75;
                lungeP = Math.min(1, Math.pow(legP, 1.35) * 1.35);
                if (legP < 0.1) triggerLaunchDust(rearAnchorX, GROUND_Y);
            }

            if (lungeP > 0.35) rearInstepAngle = Math.min(12, (lungeP - 0.35) * 18.5);
        } else {
            let subP = (p - 0.65) / 0.35;
            lungeP = 1 - subP;
            armP = Math.max(0, 1 - subP * 1.4);
            rearInstepAngle = Math.max(0, 12 * (1 - subP * 2));
        }

        const pelvisDrop = Math.pow(lungeP, 2.5) * 16;
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

        const isPhysicalContact = (actualTipX >= targetPostX) && (p >= 0.25 && p < 0.65);

        if (isPhysicalContact && !targetPostHitInCycle) {
            targetPostHitInCycle = true;
            playSteelClack();
            triggerHitStop(70, 4.0);
            createParticleBurst(targetPostX, targetY, '#22c55e', 22);
        }

        drawBiomechanicalFencer({
            pelvisX, pelvisY,
            frontFootX, frontFootY, frontTilt,
            rearFootX: rearAnchorX, rearFootY: GROUND_Y,
            rearFootTurned90: true,
            rearFootInstepRoll: rearInstepAngle,
            torsoIncline: lungeP * 0.08,
            armState: 'lunge', armExtension: armP,
            bladeAngle: bladeAngle,
            rearArmActiveLunge: lungeP,
            targetSurfaceX: isPhysicalContact ? targetPostX : 0,
            targetSurfaceY: targetY,
            gazeTargetX: targetPostX,
            gazeTargetY: targetY
        });

        if (lungeP > 0.85) {
            ctx.save();
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(frontFootX, 260); ctx.lineTo(frontFootX, GROUND_Y); ctx.stroke();
            ctx.fillStyle = '#22c55e'; ctx.font = 'bold 12px "Mukta", sans-serif';
            ctx.fillText("९०° नडगी कोन", frontFootX - 22, 256);
            ctx.restore();
        }

        drawHUDCard(620, 130, "लंज नियम 🚀", "१. हात आधी = राईट-ऑफ-वे", "२. पुढचा गुडघा ९०° (अचूक तोल)", true);
    }

    function renderDrill9_LungeRecoveryProfile(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        const rearAnchorX = 240;
        const baseStance = 48;
        const maxLungeReach = 64;

        let p = (t % 12500) / 12500;
        let isLunge = p < 0.45;
        let isRecovering = p >= 0.45 && p < 0.75;

        let frontFootX, frontFootY = GROUND_Y, frontTilt = 0;
        let pelvisX, pelvisY;
        let rearArmTension = 0;

        if (isLunge) {
            frontFootX = rearAnchorX + baseStance + maxLungeReach;
            pelvisX = rearAnchorX + 24 + 40;
            pelvisY = 268;
            rearArmTension = 1.0;
        } else if (isRecovering) {
            let recP = (p - 0.45) / 0.30;
            frontFootX = rearAnchorX + baseStance + maxLungeReach - (recP * maxLungeReach);
            frontTilt = -18 * Math.sin(recP * Math.PI);
            frontFootY = GROUND_Y - (4.0 * Math.sin(recP * Math.PI));
            pelvisX = rearAnchorX + 24 + (40 * (1 - recP));
            pelvisY = 268 - (14 * recP);
            rearArmTension = 1 - recP;
        } else {
            frontFootX = rearAnchorX + baseStance;
            pelvisX = rearAnchorX + 24;
            pelvisY = 254;
            rearArmTension = 0;
        }

        drawBiomechanicalFencer({
            pelvisX, pelvisY,
            frontFootX, frontFootY, frontTilt,
            rearFootX: rearAnchorX, rearFootY: GROUND_Y,
            rearFootTurned90: true,
            armState: isLunge ? 'lunge' : 'enGarde',
            armExtension: isLunge ? 1.0 : 0,
            rearArmActiveLunge: rearArmTension
        });

        drawHUDCard(620, 130, "रिकव्हरी रहस्य 🔄", "पुढच्या टाचेने मागे ढकल", "कधीही लंजमध्ये अडकू नकोस!", true);
    }

    function renderDrill10_ForteParryRiposte(t) {
        drawCompetitionStrip(GROUND_Y);
        clearErrorZones();

        const p = (t % DRILL_DURATION) / DRILL_DURATION;
        const isEvading = p < 0.35;
        const isParrying = p >= 0.35 && p < 0.65;
        const isRiposting = p >= 0.65;

        let rivaK;
        if (isEvading) {
            let stepP = p / 0.35;
            rivaK = getStepKinematics(230, 48, 30, stepP, false);
        } else if (isRiposting) {
            let ripStepP = (p - 0.65) / 0.35;
            rivaK = {
                pelvisX: 215 + (ripStepP * 12),
                frontFootX: 239 + (ripStepP * 24), frontFootY: GROUND_Y, frontTilt: 0,
                rearFootX: 191, rearFootY: GROUND_Y, rearTilt: 0
            };
        } else {
            rivaK = {
                pelvisX: 215,
                frontFootX: 239, frontFootY: GROUND_Y, frontTilt: 0,
                rearFootX: 191, rearFootY: GROUND_Y, rearTilt: 0
            };
        }

        const oppBaseRearX = 485;
        const oppAdvanceDist = 36;
        const oppMaxLungeSplit = 58;
        let oppFrontX, oppRearX, oppPelvisX, oppPelvisY;

        if (p < 0.35) {
            let advP = p / 0.35;
            let k = getOpponentStepKinematics(oppBaseRearX, 48, oppAdvanceDist, advP, true);
            oppFrontX = k.frontFootX;
            oppRearX = k.rearFootX;
            oppPelvisX = k.pelvisX;
            oppPelvisY = 254;
        } else {
            let lungeSubP = (p - 0.35) / 0.65;
            oppRearX = oppBaseRearX - oppAdvanceDist;
            oppFrontX = (oppRearX - 48) - (lungeSubP * oppMaxLungeSplit);
            oppPelvisX = (oppRearX - 24) - (lungeSubP * 34);
            oppPelvisY = 254 + (Math.pow(lungeSubP, 2.5) * 14);
        }

        const oppChestX = oppPelvisX - 16;
        const oppChestY = 226;

        let rivaBladeAngle = -4;
        let oppBladeAngle = -4;

        if (isParrying) {
            rivaBladeAngle = -16;
            oppBladeAngle = 14;
        } else if (isRiposting) {
            rivaBladeAngle = -1.5;
            oppBladeAngle = 24;
        }

        const riposteExt = isRiposting ? (p - 0.65) / 0.35 : 0;
        const isTouch = riposteExt > 0.65;

        if (isTouch) {
            if (!drill10HitInCycle) {
                drill10HitInCycle = true;
                playSteelClack();
                triggerHitStop(70, 3.5);
                createParticleBurst(oppChestX, oppChestY, '#22c55e', 22);
            }
        } else if (p < 0.65) {
            drill10HitInCycle = false;
        }

        drawBiomechanicalFencer({
            pelvisX: rivaK.pelvisX, pelvisY: 254,
            frontFootX: rivaK.frontFootX, frontFootY: rivaK.frontFootY, frontTilt: rivaK.frontTilt,
            rearFootX: rivaK.rearFootX, rearFootY: rivaK.rearFootY, rearTilt: rivaK.rearTilt,
            rearFootTurned90: true,
            armState: isRiposting ? 'attack' : 'enGarde',
            armExtension: Math.min(1, riposteExt * 1.4),
            bladeAngle: rivaBladeAngle,
            targetSurfaceX: isTouch ? oppChestX : 0,
            targetSurfaceY: oppChestY,
            gazeTargetX: oppChestX,
            gazeTargetY: oppChestY
        });

        drawBiomechanicalFencer({
            pelvisX: oppPelvisX, pelvisY: oppPelvisY,
            frontFootX: oppFrontX, frontFootY: GROUND_Y,
            rearFootX: oppRearX, rearFootY: GROUND_Y,
            rearFootTurned90: true,
            isOpponent: true,
            armState: 'attack',
            armExtension: Math.min(1, p * 1.8),
            bladeAngle: oppBladeAngle
        });

        if (isParrying) {
            const clashX = (rivaK.pelvisX + 31 + 42);
            const clashY = 224;
            drawSteelClashSparks(clashX, clashY);
        }

        drawHUDCard(620, 130, "पॅरी + रिपोस्ट 🛡️", "१. मागे सरकून जागा बनव", "२. Forte vs Foible ➔ ३. रिपोस्ट!", true);
    }

    // -------------------------------------------------------------
    // STOPWATCH & STATE MACHINE SYNCHRONIZATION
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
                badgeText.innerText = `Drill #3 (${currentDrill + 1}/${TOTAL_SUB_DRILLS})`;
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
                targetPostHitInCycle = false;
                drill10HitInCycle = false;
            }

            updateDrillStateMachine(effectiveElapsed);
        }

        ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        applyCameraTransform();

        if (currentDrill === 0) renderDrill1_FootBaseAndImpulse(effectiveElapsed);
        else if (currentDrill === 1) renderDrill2_ElbowAndDecoupling(effectiveElapsed);
        else if (currentDrill === 2) renderDrill3_FlatPlaneTranslation(effectiveElapsed);
        else if (currentDrill === 3) renderDrill4_DistalPhalanxGrip(effectiveElapsed);
        else if (currentDrill === 4) renderDrill5_HeelToeStride(effectiveElapsed);
        else if (currentDrill === 5) renderDrill6_SpatialDistanceManagement(effectiveElapsed);
        else if (currentDrill === 6) renderDrill7_RetreatBraking(effectiveElapsed);
        else if (currentDrill === 7) renderDrill8_RocketLungeRoW(effectiveElapsed);
        else if (currentDrill === 8) renderDrill9_LungeRecoveryProfile(effectiveElapsed);
        else if (currentDrill === 9) renderDrill10_ForteParryRiposte(effectiveElapsed);

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
        id: 3,
        title: "Drill #3",
        subDrills: SUB_DRILL_TITLES,
        init: () => {
            initAudio();
            isPaused = false;
            effectiveElapsed = 0;
            currentDrill = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            targetPostHitInCycle = false;
            drill10HitInCycle = false;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        restart: () => {
            stopAllSpeech();
            initAudio();
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            targetPostHitInCycle = false;
            drill10HitInCycle = false;
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
            targetPostHitInCycle = false;
            drill10HitInCycle = false;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        nextSubDrill: () => {
            stopAllSpeech();
            currentDrill = (currentDrill + 1) % TOTAL_SUB_DRILLS;
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            targetPostHitInCycle = false;
            drill10HitInCycle = false;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        prevSubDrill: () => {
            stopAllSpeech();
            currentDrill = (currentDrill - 1 + TOTAL_SUB_DRILLS) % TOTAL_SUB_DRILLS;
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            targetPostHitInCycle = false;
            drill10HitInCycle = false;
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
