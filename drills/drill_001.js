/**
 * Riva Fencer - Cartridge 001 (Try #2)
 * Cleaned canvas HUD (duplicate clock removed), natural Marathi speech, and unified stepping/scrubbing.
 */
(function () {
    const canvas = document.getElementById('fencingCanvas');
    const ctx = canvas.getContext('2d');
    const statusBox = document.getElementById('status-box');
    const badgeText = document.getElementById('drillHeaderBadgeText');
    const timerNumber = document.getElementById('timer-number');
    const timerProgress = document.getElementById('timerProgress');

    const BASE_WIDTH = 820;
    const BASE_HEIGHT = 420;
    const GROUND_Y = 312;
    const DRILL_DURATION = 30000;

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
    // RETICLE & TAP CORRECTION ENGINE
    // -------------------------------------------------------------
    let activeErrorZones = [];
    let visualRipples = [];

    function registerErrorZone(id, x, y, radius, onCorrectCallback) {
        activeErrorZones.push({ id, x, y, radius, onCorrect: onCorrectCallback });
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
        visualRipples.push({ x, y, radius: 4, maxRadius: 20, alpha: 0.8, color: '#ef4444' });
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

            ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
            ctx.fill();

            ctx.fillStyle = '#fca5a5';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText("येथे टॅप करा", zone.x, zone.y - zone.radius - 6);
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
    // HIT-STOP & CAMERA SHAKE
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

    // -------------------------------------------------------------
    // NATURAL MARATHI TTS
    // -------------------------------------------------------------
    let isMuted = false;
    let audioUnlocked = false;
    let availableVoices = [];

    function initAudio() {
        audioUnlocked = true;
        requestWakeLock();
        if ('speechSynthesis' in window) {
            availableVoices = window.speechSynthesis.getVoices() || [];
        }
    }

    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = () => {
            availableVoices = window.speechSynthesis.getVoices() || [];
        };
    }

    function getPersonalized(str) {
        const saved = JSON.parse(localStorage.getItem('riva_athlete')) || { name: 'रीवा' };
        return str.replaceAll('रीवा', saved.name);
    }

    function speakCoachingCue(marathiString) {
        if (!('speechSynthesis' in window) || !audioUnlocked || isMuted) return;
        window.speechSynthesis.cancel();

        const cleanMarathi = getPersonalized(marathiString)
            .replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{2600}-\u{27BF}]/gu, '')
            .replace(/[➔➡️⬅️⚡💡🐢⭐⏱️🔊⏸️🚀🤺📐🦶🦵✓❌✅🎯]/g, '')
            .replace(/[()[\]{}|]/g, '')
            .replace(/[०-९0-9]+[.]?[०-९0-9]*/g, '')
            .replace(/['"]/g, '')
            .trim();

        if (!cleanMarathi) return;

        const utterance = new SpeechSynthesisUtterance(cleanMarathi);
        const marathiVoice = availableVoices.find(v => v.lang.toLowerCase().includes('mr')) || null;
        const hindiVoice = availableVoices.find(v => v.lang.toLowerCase().includes('hi')) || null;
        
        if (marathiVoice) {
            utterance.voice = marathiVoice;
            utterance.lang = 'mr-IN';
        } else if (hindiVoice) {
            utterance.voice = hindiVoice;
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
    // 8 SUB-DRILLS
    // -------------------------------------------------------------
    const drillTimelineConfigs = [
        {
            drillId: 0,
            title: "१. 'L' पोझिशन",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "दोन्ही पावले जवळ ठेवा आणि सरळ उभे राहा.", status: "१. दोन्ही पावले जवळ जोडून ताठ उभे राहा. (लाल त्रुटीवर टॅप करा)", color: "#ef4444" },
                { startTime: 9000, subPhase: 1, marathiText: "मागचा पाय नव्वद अंशात फिरवून एल आकार बनवा.", status: "२. पुढचा पाय सरळ ठेवून, मागचा पाय ९० अंशात फिरवा ('L' आकार)!", color: "#facc15" },
                { startTime: 18000, subPhase: 2, marathiText: "शाब्बास रीवा, अचूक एल पोझिशन तयार झाली आहे!", status: "✅ अचूक 'L' कोन आणि नैसर्गिक अंतर पूर्ण!", color: "#22c55e" }
            ]
        },
        {
            drillId: 1,
            title: "२. एन गार्डे",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "पाय ताठ ठेवू नका. गुडघे वाकवा.", status: "❌ चूक: पाय ताठ ठेवल्यास तोल जातो! (गुडघ्यावर टॅप करा)", color: "#ef4444" },
                { startTime: 10000, subPhase: 1, marathiText: "गुडघे हलके वाकवून एन गार्डे स्प्रिंग करा.", status: "✅ योग्य एन गार्डे: गुडघे ११०° किंचित वाकवून स्प्रिंगसारखे ठेवा!", color: "#22c55e" }
            ]
        },
        {
            drillId: 2,
            title: "३. पाऊल क्रम",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "पुढे जाताना आधी पुढची टाच, मग मागचा पाय.", status: "➡️ पुढे: पुढचा पाय लीडर (आधी टाच ➔ मग चवडा टेकवा)!", color: "#38bdf8" },
                { startTime: 11000, subPhase: 1, marathiText: "मागे येताना आधी मागचा चवडा, मग पुढचा पाय.", status: "⬅️ मागे: मागचा पाय लीडर (आधी चवडा ➔ मग टाच टेकवा)!", color: "#4ade80" },
                { startTime: 22000, subPhase: 2, marathiText: "शाब्बास रीवा, पाऊल क्रम परिपूर्ण!", status: "🎯 शाब्बास रीवा! पाऊल क्रम १०० टक्के परिपूर्ण!", color: "#22c55e" }
            ]
        },
        {
            drillId: 3,
            title: "४. लेझर टिप",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "मनगट स्थिर करा, टोक छताकडे जाऊ देऊ नका.", status: "❌ चूक: टोक छताकडे गेले आहे! (मनगटावर टॅप करा)", color: "#ef4444" },
                { startTime: 8000, subPhase: 1, marathiText: "पुढे चालतानाही टोक छातीवर रोखून ठेवा.", status: "🦶 पुढे चालतानाही लेझर टोक छातीवर रोखून ठेवा!", color: "#38bdf8" },
                { startTime: 18000, subPhase: 2, marathiText: "मागे सरकतानाही अचूक लेझर लॉक!", status: "🎯 मागे सरकतानाही लेझर थेट छातीवर १००% लॉक!", color: "#22c55e" }
            ]
        },
        {
            drillId: 4,
            title: "५. अटॅक",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "एन गार्डे तयार राहा.", status: "१. एन गार्डे तयार राहा - कोपर शरीराच्या समोर.", color: "#38bdf8" },
                { startTime: 6000, subPhase: 1, marathiText: "हात आधी... मग पाय स्फोटक पुढे!", status: "२. आधी हात निघून रेषेत ➔ मग पाय वेगाने जमिनीवर!", color: "#facc15" },
                { startTime: 17500, subPhase: 2, marathiText: "टच! तोल स्थिर ठेवा.", status: "🎯 अचूक पॉईंट! डमीवर स्पर्श १ सेकंद स्थिर ठेवा!", color: "#22c55e" },
                { startTime: 21500, subPhase: 3, marathiText: "सुरक्षित मागे या.", status: "३. सुरक्षित एन गार्डेवर रिकव्हर व्हा.", color: "#38bdf8" }
            ]
        },
        {
            drillId: 5,
            title: "६. रॉकेट लंज",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "लंजसाठी तयार राहा.", status: "१. लक्ष्य छातीवर रोखा - लंजसाठी स्प्रिंग तयार ठेवा!", color: "#38bdf8" },
                { startTime: 6500, subPhase: 1, marathiText: "हात आधी, मागचा पाय स्थिर, रॉकेट लंज!", status: "२. हात आधी ➔ मागच्या पायाने धक्का ➔ ९०° अचूक लंज!", color: "#4ade80" },
                { startTime: 17500, subPhase: 2, marathiText: "शाब्बास! लंज स्थिर ठेवा.", status: "🎯 शाब्बास रीवा! अचूक लंजचा तोल १ सेकंद स्थिर ठेवा!", color: "#22c55e" },
                { startTime: 21500, subPhase: 3, marathiText: "पुढच्या टाचेने ढकलून मागे या.", status: "३. पुढच्या टाचेने जमिनीला ढकला आणि रिकव्हर व्हा!", color: "#38bdf8" }
            ]
        },
        {
            drillId: 6,
            title: "७. पॅरी ४",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "प्रतिस्पर्ध्याचे आक्रमण पाहा, अंतर राखा.", status: "१. प्रतिस्पर्ध्याचे आक्रमण ओळखा, सज्ज राहा.", color: "#38bdf8" },
                { startTime: 6000, subPhase: 1, marathiText: "मागे पाऊल, कोपर स्थिर, पॅरी चार!", status: "२. मागे पाऊल, कोपर बरगडीजवळ ठेवून डावीकडे पॅरी ४!", color: "#facc15" },
                { startTime: 15000, subPhase: 2, marathiText: "हात मागे न घेता थेट छातीवर रिपोस्ट!", status: "३. हात मागे न घेता थेट छातीवर रिपोस्ट!", color: "#22c55e" },
                { startTime: 23000, subPhase: 3, marathiText: "शाब्बास रीवा, उत्कृष्ट पॅरी चार व रिपोस्ट!", status: "४. अचूक पॅरी चार व रिपोस्ट पूर्ण! शाब्बास!", color: "#38bdf8" }
            ]
        },
        {
            drillId: 7,
            title: "८. पॅरी ६",
            phases: [
                { startTime: 0, subPhase: 0, marathiText: "प्रतिस्पर्ध्याचे आक्रमण ओळखा.", status: "१. प्रतिस्पर्ध्याच्या आक्रमणाची दिशा ओळखा.", color: "#38bdf8" },
                { startTime: 6000, subPhase: 1, marathiText: "अंगठा वर, उजवीकडे पॅरी सहा!", status: "२. मागे पाऊल, अंगठा वर! उजवीकडे पॅरी ६!", color: "#facc15" },
                { startTime: 15000, subPhase: 2, marathiText: "बरगड्यांवर थेट रिपोस्ट, टच!", status: "३. रिपोस्ट: प्रतिस्पर्ध्याच्या बरगड्यांवर अचूक स्पर्श!", color: "#22c55e" },
                { startTime: 23000, subPhase: 3, marathiText: "शाब्बास रीवा, सुंदर पॅरी सहा!", status: "४. पॅरी ६ व रिपोस्ट पूर्ण! शाब्बास!", color: "#38bdf8" }
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

    // SCREEN PRESS-AND-HOLD SLOW-MOTION
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
    // ANATOMICAL INVERSE KINEMATICS & APPAREL
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

    function drawAuthenticShoe(x, y, tiltDeg, isFront, isTurned90, facingLeft = false) {
        ctx.save();
        ctx.translate(x, y);
        if (facingLeft) ctx.scale(-1, 1);
        ctx.rotate((tiltDeg * Math.PI) / 180);

        ctx.fillStyle = '#0284c7';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.1;

        if (isTurned90) {
            ctx.beginPath();
            ctx.roundRect(-7, -8, 14, 8, [3, 3, 2, 2]);
            ctx.fill(); ctx.stroke();

            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(-7, -2.5, 14, 2.5);
        } else {
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

    function drawFoilLameVest(pelvisX, pelvisY, shoulderX, shoulderY, isOpponent, isError = false) {
        ctx.save();
        ctx.fillStyle = isError ? '#fca5a5' : (isOpponent ? '#475569' : '#0284c7');
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

    function drawAuthenticMask(headX, headY, gazeTargetX, gazeTargetY, isOpponent, isError = false) {
        ctx.save();
        ctx.fillStyle = isOpponent ? '#334155' : '#0284c7';
        ctx.strokeStyle = isError ? '#ef4444' : '#64748b';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(headX - 10, headY + 8);
        ctx.quadraticCurveTo(headX + (isOpponent ? -12 : 12), headY + 16, headX + (isOpponent ? -7 : 7), headY + 22);
        ctx.lineTo(headX - (isOpponent ? -2 : 2), headY + 22);
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

    function calculateEulerBladeBuckle(handX, handY, angleDeg, targetX, targetY, isFlankHit) {
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

        const normalAngle = rad + (isFlankHit ? (Math.PI / 2) : (-Math.PI / 2));
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

    function drawAuthenticFoil(handX, handY, angleDeg, targetX, targetY, isFlankHit = false) {
        const spine = calculateEulerBladeBuckle(handX, handY, angleDeg, targetX, targetY, isFlankHit);
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
                triggerHitStop(75, 4.2);
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

    function drawFencingStrip(groundY) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, groundY, BASE_WIDTH, BASE_HEIGHT - groundY);
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(BASE_WIDTH, groundY); ctx.stroke();
        ctx.fillStyle = '#334155';
        for (let x = 40; x < BASE_WIDTH; x += 40) ctx.fillRect(x, groundY + 1, 2, 8);
    }

    function drawU10Fencer(cfg) {
        const {
            pelvisX, pelvisY,
            frontFootX, frontFootY, frontTilt = 0,
            rearFootX, rearFootY, rearTilt = 0,
            rearFootTurned90 = true,
            torsoIncline = 0,
            armState = 'enGarde',
            armExtension = 0,
            bladeAngle = -5,
            targetSurfaceX = 0,
            targetSurfaceY = 0,
            isFlankHit = false,
            isError = false,
            rearArmActiveLunge = 0,
            gazeTargetX = 0,
            gazeTargetY = 0
        } = cfg;

        const femur = 46;
        const tibia = 43;

        const rearHipX = pelvisX - 5;
        const rearHipY = pelvisY;
        const rearAnkleY = rearFootY - 6;
        const rearIK = solveLegIK(rearHipX, rearHipY, rearFootX, rearAnkleY, femur, tibia, false);
        drawAnatomicalContouredLeg(rearHipX, rearHipY, rearIK.kx, rearIK.ky, rearFootX, rearAnkleY, false);
        drawAuthenticShoe(rearFootX, rearFootY, rearTilt, false, rearFootTurned90, false);

        const frontHipX = pelvisX + 5;
        const frontHipY = pelvisY;
        const frontAnkleY = frontFootY - 6;
        const frontIK = solveLegIK(frontHipX, frontHipY, frontFootX, frontAnkleY, femur, tibia, true);
        drawAnatomicalContouredLeg(frontHipX, frontHipY, frontIK.kx, frontIK.ky, frontFootX, frontAnkleY, true);
        drawAuthenticShoe(frontFootX, frontFootY, frontTilt, true, false, false);

        const shoulderX = pelvisX + 3 + (torsoIncline * 10);
        const shoulderY = pelvisY - 50;

        ctx.save();
        ctx.fillStyle = isError ? '#fca5a5' : '#f1f5f9';
        ctx.beginPath();
        ctx.roundRect(pelvisX - 9, pelvisY - 4, 18, 9, [2, 2, 3, 3]);
        ctx.fill();
        ctx.restore();

        drawFoilLameVest(pelvisX, pelvisY, shoulderX, shoulderY, false, isError);

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
        drawAuthenticMask(headX, headY, gazeTargetX, gazeTargetY, false, isError);

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
            drawAuthenticFoil(handX, handY, bladeAngle, 0, 0, false);
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
            drawAuthenticFoil(handX, handY, bladeAngle, targetSurfaceX, targetSurfaceY, isFlankHit);
        }
    }

    function drawTrainingDummy(x, groundY, targetY, label) {
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

        if (label) {
            ctx.fillStyle = '#facc15';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText(label, x - 25, targetY + 52);
        }
        ctx.restore();
    }

    function drawSternumTarget(x, y, label) {
        ctx.save();
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
        if (label) {
            ctx.fillStyle = '#facc15'; ctx.font = 'bold 12px sans-serif';
            ctx.fillText(label, x - 55, y + 30);
        }
        ctx.restore();
    }

    function drawOpponentFencer(baseRearX, groundY, attackP, parryEngagement, riposteProgress, isParry6, rivaGuardX, rivaGuardY) {
        const femur = 46, tibia = 43;
        const baseStance = 48;
        const advanceDist = 38;
        const maxLungeSplit = 62;

        let rearFootX, frontFootX, pelvisX, pelvisY;
        let frontTilt = 0, rearTilt = 0, frontFootY = groundY;

        if (attackP < 0.35) {
            const advP = attackP / 0.35;
            if (advP < 0.5) {
                const subP = advP / 0.5;
                rearFootX = baseRearX;
                frontFootX = (baseRearX - baseStance) - (subP * advanceDist);
                frontTilt = 18 * Math.sin(subP * Math.PI);
                frontFootY = groundY - (4.0 * Math.sin(subP * Math.PI));
                pelvisX = (baseRearX - 24) - (subP * advanceDist * 0.5);
            } else {
                const subP = (advP - 0.5) / 0.5;
                frontFootX = (baseRearX - baseStance) - advanceDist;
                rearFootX = baseRearX - (subP * advanceDist);
                rearTilt = -12 * Math.sin(subP * Math.PI);
                pelvisX = (baseRearX - 24) - (advanceDist * 0.5) - (subP * advanceDist * 0.5);
            }
            pelvisY = groundY - 60;
        } else {
            const lungeSubP = (attackP - 0.35) / 0.65;
            rearFootX = baseRearX - advanceDist;
            frontFootX = (rearFootX - baseStance) - (lungeSubP * maxLungeSplit);

            pelvisX = (rearFootX - 24) - (lungeSubP * 38);
            const pelvisDrop = Math.pow(lungeSubP, 2.5) * 16;
            pelvisY = groundY - 60 + pelvisDrop;

            if (lungeSubP > 0.15 && lungeSubP < 0.85) {
                frontTilt = 20 * Math.sin(((lungeSubP - 0.15) / 0.7) * Math.PI);
                frontFootY = groundY - (4.5 * Math.sin(((lungeSubP - 0.15) / 0.7) * Math.PI));
            }
        }

        const shoulderX = pelvisX - 3;
        const shoulderY = pelvisY - 50;

        const frontIK = solveLegIK(pelvisX - 5, pelvisY, frontFootX, frontFootY - 6, femur, tibia, false);
        const rearIK = solveLegIK(pelvisX + 5, pelvisY, rearFootX, groundY - 6, femur, tibia, true);

        drawAnatomicalContouredLeg(pelvisX + 5, pelvisY, rearIK.kx, rearIK.ky, rearFootX, groundY - 6, false);
        drawAnatomicalContouredLeg(pelvisX - 5, pelvisY, frontIK.kx, frontIK.ky, frontFootX, frontFootY - 6, true);

        drawAuthenticShoe(rearFootX, groundY, rearTilt, false, true, false);
        drawAuthenticShoe(frontFootX, frontFootY, frontTilt, true, false, true);

        drawFoilLameVest(pelvisX, pelvisY, shoulderX, shoulderY, true, false);
        drawAuthenticMask(shoulderX - 3, shoulderY - 18, 0, 0, true, false);

        const sX = shoulderX - 7;
        const sY = shoulderY + 10;

        let reach = 24 + (attackP * 36);
        let handX = sX - reach;
        let handY = sY;

        if (riposteProgress > 0) {
            const yieldAmt = Math.min(1, riposteProgress * 1.4);
            handX = sX - reach + (yieldAmt * 30);
            handY = sY + (isParry6 ? -18 : 16) * yieldAmt;
        }

        ctx.save();
        ctx.strokeStyle = '#64748b'; ctx.lineWidth = 3.8; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sX, sY); ctx.lineTo(handX, handY); ctx.stroke();
        ctx.restore();

        const bladeLen = 104;
        let deflAngleDeg = 0;
        if (parryEngagement > 0.35 && riposteProgress === 0) {
            deflAngleDeg = isParry6 ? 17 : -17;
        } else if (riposteProgress > 0) {
            deflAngleDeg = isParry6 ? 26 : -26;
        }

        const rad = (deflAngleDeg * Math.PI) / 180;
        const tipX = handX - Math.cos(rad) * bladeLen;
        const tipY = handY + Math.sin(rad) * bladeLen;

        ctx.save();
        ctx.translate(handX, handY);
        ctx.rotate(rad + Math.PI);
        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#334155';
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.8, 10, 0, -Math.PI / 2, Math.PI / 2, true);
        ctx.fill(); ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(handX - 3, handY); ctx.lineTo(tipX, tipY); ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(tipX, tipY, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // -------------------------------------------------------------
    // SUB-DRILL ANIMATION ROUTINES
    // -------------------------------------------------------------
    function renderDrill1_LStance(t) {
        drawFencingStrip(GROUND_Y);
        const fencerX = 410;
        const phase = t < 9000 ? 0 : (t < 18000 ? 1 : 2);
        let stanceWidth = 14;
        let rearTurned = false;

        clearErrorZones();

        if (phase === 0) {
            stanceWidth = 14; rearTurned = false;
            registerErrorZone('d1_foot', fencerX - 7, GROUND_Y - 8, 24, () => {
                effectiveElapsed = 9005;
            });
        } else if (phase === 1) {
            stanceWidth = 14; rearTurned = true;
        } else {
            stanceWidth = 48; rearTurned = true;
        }

        drawU10Fencer({
            pelvisX: fencerX, pelvisY: 242,
            frontFootX: fencerX + (stanceWidth / 2), frontFootY: GROUND_Y,
            rearFootX: fencerX - (stanceWidth / 2), rearFootY: GROUND_Y,
            rearFootTurned90: rearTurned,
            isError: phase === 0
        });
    }

    function renderDrill2_EnGarde(t) {
        drawFencingStrip(GROUND_Y);
        const fencerX = 410;
        const phase = t < 10000 ? 0 : 1;
        const pelvisDrop = phase === 0 ? 0 : 12;

        clearErrorZones();

        if (phase === 0) {
            registerErrorZone('d2_knee', fencerX, 260, 28, () => {
                effectiveElapsed = 10005;
            });
        }

        drawU10Fencer({
            pelvisX: fencerX, pelvisY: 242 + pelvisDrop,
            frontFootX: fencerX + 24, frontFootY: GROUND_Y,
            rearFootX: fencerX - 24, rearFootY: GROUND_Y,
            rearFootTurned90: true,
            isError: phase === 0
        });
    }

    function renderDrill3_StepSequence(t) {
        drawFencingStrip(GROUND_Y);
        clearErrorZones();

        const baseStance = 48;
        const stepDist = 38;
        const centerX = 400;
        const startFrontX = centerX + baseStance / 2;
        const startBackX = centerX - baseStance / 2;

        let frontX = startFrontX, backX = startBackX;
        let frontTilt = 0, rearTilt = 0, frontY = GROUND_Y, backY = GROUND_Y;
        let pelvisOffset = 0, pelvicMicroRise = 0;

        if (t < 11000) {
            const p = Math.min(1, Math.max(0, (t - 1500) / 7500));
            if (p < 0.5) {
                const subP = p / 0.5;
                backX = startBackX;
                frontX = startFrontX + (subP * stepDist);
                if (subP < 0.8) {
                    frontTilt = -18;
                    frontY = GROUND_Y - (4.5 * Math.sin((subP / 0.8) * Math.PI));
                } else {
                    const landP = (subP - 0.8) / 0.2;
                    frontTilt = -18 * (1 - landP);
                    frontY = GROUND_Y;
                }
                pelvisOffset = subP * (stepDist * 0.5);
                pelvicMicroRise = -2.2 * Math.sin(subP * Math.PI);
            } else {
                const subP = (p - 0.5) / 0.5;
                frontX = startFrontX + stepDist;
                backX = startBackX + (subP * stepDist);
                rearTilt = 12 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) + (subP * stepDist * 0.5);
                pelvicMicroRise = -1.8 * Math.sin(subP * Math.PI);
            }
        } else if (t < 22000) {
            const p = Math.min(1, Math.max(0, (t - 12500) / 7500));
            const advancedFrontX = startFrontX + stepDist;
            const advancedBackX = startBackX + stepDist;

            if (p < 0.5) {
                const subP = p / 0.5;
                frontX = advancedFrontX;
                backX = advancedBackX - (subP * stepDist);
                rearTilt = 18 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (4.5 * Math.sin(subP * Math.PI));
                pelvisOffset = stepDist - (subP * (stepDist * 0.5));
                pelvicMicroRise = -2.2 * Math.sin(subP * Math.PI);
            } else {
                const subP = (p - 0.5) / 0.5;
                backX = startBackX;
                frontX = advancedFrontX - (subP * stepDist);
                frontTilt = -14 * Math.sin(subP * Math.PI);
                frontY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) - (subP * stepDist * 0.5);
                pelvicMicroRise = -1.8 * Math.sin(subP * Math.PI);
            }
        }

        drawU10Fencer({
            pelvisX: centerX + pelvisOffset, pelvisY: 254 + pelvicMicroRise,
            frontFootX: frontX, frontFootY: frontY, frontTilt: frontTilt,
            rearFootX: backX, rearFootY: backY, rearTilt: rearTilt,
            rearFootTurned90: true
        });
    }

    function renderDrill4_LaserTip(t) {
        drawFencingStrip(GROUND_Y);
        clearErrorZones();

        const targetX = 660, targetY = 214;
        drawSternumTarget(targetX, targetY, "छाती (Sternum)");

        const baseStance = 48;
        const startX = 260;
        const stepDist = 34;

        let frontX = startX + baseStance / 2;
        let backX = startX - baseStance / 2;
        let frontTilt = 0, rearTilt = 0, frontY = GROUND_Y, backY = GROUND_Y;
        let pelvisOffset = 0;
        let tipAngle = -3;
        let isError = false;

        if (t < 8000) {
            tipAngle = -36;
            isError = true;
            registerErrorZone('d4_wrist', startX + 32, 218, 25, () => {
                effectiveElapsed = 8005;
            });
        } else if (t < 18000) {
            const p = (t - 8000) / 10000;
            if (p < 0.5) {
                const subP = p / 0.5;
                backX = startX - baseStance / 2;
                frontX = (startX + baseStance / 2) + (subP * stepDist);
                frontTilt = -18 * Math.sin(subP * Math.PI);
                frontY = GROUND_Y - (4.0 * Math.sin(subP * Math.PI));
                pelvisOffset = subP * (stepDist * 0.5);
            } else {
                const subP = (p - 0.5) / 0.5;
                frontX = (startX + baseStance / 2) + stepDist;
                backX = (startX - baseStance / 2) + (subP * stepDist);
                rearTilt = 12 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) + (subP * stepDist * 0.5);
            }
        } else {
            const p = (t - 18000) / 12000;
            const advFrontX = startX + baseStance / 2 + stepDist;
            const advBackX = startX - baseStance / 2 + stepDist;
            if (p < 0.5) {
                const subP = p / 0.5;
                frontX = advFrontX;
                backX = advBackX - (subP * stepDist);
                rearTilt = 16 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (4.0 * Math.sin(subP * Math.PI));
                pelvisOffset = stepDist - (subP * (stepDist * 0.5));
            } else {
                const subP = (p - 0.5) / 0.5;
                backX = startX - baseStance / 2;
                frontX = advFrontX - (subP * stepDist);
                frontTilt = -14 * Math.sin(subP * Math.PI);
                frontY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) - (subP * stepDist * 0.5);
            }
        }

        const currentMidX = startX + pelvisOffset;

        if (!isError) {
            const handX = currentMidX + 34;
            const handY = 216;
            const rad = (tipAngle * Math.PI) / 180;
            const tipX = handX + Math.cos(rad) * 104;
            const tipY = handY + Math.sin(rad) * 104;

            ctx.save();
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
            ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(targetX, targetY); ctx.stroke();
            ctx.restore();
        }

        drawU10Fencer({
            pelvisX: currentMidX, pelvisY: 254,
            frontFootX: frontX, frontFootY: frontY, frontTilt: frontTilt,
            rearFootX: backX, rearFootY: backY, rearTilt: rearTilt,
            rearFootTurned90: true,
            bladeAngle: tipAngle,
            isError: isError,
            gazeTargetX: targetX,
            gazeTargetY: targetY
        });
    }

    function renderDrill5_BasicAttack(t) {
        drawFencingStrip(GROUND_Y);
        clearErrorZones();

        const baseStance = 48;
        const startX = 240;
        const stepDist = 64;
        const targetX = startX + stepDist + 10 + 24 + 16 + 104 - 4;
        const targetY = 226;

        drawTrainingDummy(targetX, GROUND_Y, targetY, "प्रॅक्टिस डमी पोस्ट");

        let armExt = 0;
        let frontX = startX + baseStance / 2;
        let backX = startX - baseStance / 2;
        let frontTilt = 0, rearTilt = 0, frontY = GROUND_Y, backY = GROUND_Y;
        let pelvisOffset = 0;

        if (t < 6000) {
            armExt = 0;
        } else if (t < 17500) {
            const p = (t - 6000) / 11500;
            const stepP = Math.max(0, (p - 0.20) / 0.80);
            armExt = p < 0.22 ? (p / 0.22) * 0.38 : (0.38 + stepP * 0.62);

            if (stepP < 0.5) {
                const subP = stepP / 0.5;
                backX = startX - baseStance / 2;
                frontX = (startX + baseStance / 2) + (subP * stepDist);
                frontTilt = -20 * Math.sin(subP * Math.PI);
                frontY = GROUND_Y - (4.5 * Math.sin(subP * Math.PI));
                pelvisOffset = subP * (stepDist * 0.5);
            } else {
                const subP = (stepP - 0.5) / 0.5;
                frontX = (startX + baseStance / 2) + stepDist;
                backX = (startX - baseStance / 2) + (subP * stepDist);
                rearTilt = 12 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) + (subP * stepDist * 0.5);
            }
        } else if (t < 21500) {
            armExt = 1;
            frontX = startX + baseStance / 2 + stepDist;
            backX = startX - baseStance / 2 + stepDist;
            pelvisOffset = stepDist;
        } else {
            const recP = (t - 21500) / 8500;
            armExt = recP < 0.25 ? 1.0 : (1.0 - ((recP - 0.25) / 0.75));
            const reachedFrontX = startX + baseStance / 2 + stepDist;
            const reachedBackX = startX - baseStance / 2 + stepDist;

            if (recP < 0.5) {
                const subP = recP / 0.5;
                frontX = reachedFrontX;
                backX = reachedBackX - (subP * stepDist);
                rearTilt = 16 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (4.0 * Math.sin(subP * Math.PI));
                pelvisOffset = stepDist - (subP * (stepDist * 0.5));
            } else {
                const subP = (recP - 0.5) / 0.5;
                backX = startX - baseStance / 2;
                frontX = reachedFrontX - (subP * stepDist);
                frontTilt = -14 * Math.sin(subP * Math.PI);
                frontY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = (stepDist * 0.5) - (subP * stepDist * 0.5);
            }
        }

        drawU10Fencer({
            pelvisX: startX + pelvisOffset, pelvisY: 254,
            frontFootX: frontX, frontFootY: frontY, frontTilt: frontTilt,
            rearFootX: backX, rearFootY: backY, rearTilt: rearTilt,
            rearFootTurned90: true,
            armState: 'attack', armExtension: armExt,
            bladeAngle: -2.0,
            targetSurfaceX: targetX, targetSurfaceY: targetY,
            gazeTargetX: targetX, gazeTargetY: targetY
        });
    }

    function renderDrill6_Lunge(t) {
        drawFencingStrip(GROUND_Y);
        clearErrorZones();

        const rearAnchorX = 250;
        const baseStance = 48;
        const maxLungeReach = 62;
        const targetX = rearAnchorX + 24 + 40 + 10 + 24 + 16 + 104 - 4;
        const targetY = 226;

        drawTrainingDummy(targetX, GROUND_Y, targetY, "प्रॅक्टिस डमी पोस्ट");

        let lungeP = 0;
        let rearArmTension = 0;

        if (t < 6500) {
            lungeP = 0;
            rearArmTension = 0;
        } else if (t < 17500) {
            const p = (t - 6500) / 11000;
            lungeP = Math.min(1, Math.pow(p, 1.35) * 1.45);
            rearArmTension = lungeP;
        } else if (t < 21500) {
            lungeP = 1;
            rearArmTension = 0.88;
        } else {
            const recP = (t - 21500) / 8500;
            lungeP = 1 - recP;
            rearArmTension = (1 - recP) * 0.88;
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

        drawU10Fencer({
            pelvisX, pelvisY,
            frontFootX, frontFootY,
            frontTilt: frontTilt,
            rearFootX: rearAnchorX, rearFootY: GROUND_Y,
            rearFootTurned90: true,
            torsoIncline: lungeP * 0.08,
            armState: 'lunge', armExtension: Math.min(1, lungeP * 1.35),
            bladeAngle: -2.5,
            rearArmActiveLunge: rearArmTension,
            targetSurfaceX: targetX, targetSurfaceY: targetY,
            gazeTargetX: targetX, gazeTargetY: targetY
        });

        if (lungeP > 0.85) {
            ctx.save();
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.8; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(frontFootX, 260); ctx.lineTo(frontFootX, GROUND_Y); ctx.stroke();
            ctx.fillStyle = '#22c55e'; ctx.font = 'bold 12px sans-serif';
            ctx.fillText("९०° अचूक कोन", frontFootX - 24, 256);
            ctx.restore();
        }
    }

    function renderDrill7_Parry4(t) {
        drawFencingStrip(GROUND_Y);
        clearErrorZones();

        const baseStance = 48;
        const retreatDist = 28;
        const startX = 230;

        let frontX = startX + baseStance / 2;
        let backX = startX - baseStance / 2;
        let frontTilt = 0, rearTilt = 0, frontY = GROUND_Y, backY = GROUND_Y;
        let pelvisOffset = 0;
        let oppAttackP = 0, rivaParryP = 0, riposteP = 0;

        if (t < 6000) {
        } else if (t < 15000) {
            const p = (t - 6000) / 9000;
            oppAttackP = p;
            rivaParryP = p;

            if (p < 0.5) {
                const subP = p / 0.5;
                frontX = startX + baseStance / 2;
                backX = (startX - baseStance / 2) - (subP * retreatDist);
                rearTilt = 18 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (4.0 * Math.sin(subP * Math.PI));
                pelvisOffset = -(subP * (retreatDist * 0.5));
            } else {
                const subP = (p - 0.5) / 0.5;
                backX = (startX - baseStance / 2) - retreatDist;
                frontX = (startX + baseStance / 2) - (subP * retreatDist);
                frontTilt = -14 * Math.sin(subP * Math.PI);
                frontY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = -(retreatDist * 0.5) - (subP * retreatDist * 0.5);
            }
        } else if (t < 23000) {
            oppAttackP = 1;
            const reachedBackX = startX - baseStance / 2 - retreatDist;
            const reachedFrontX = startX + baseStance / 2 - retreatDist;
            const p = (t - 15000) / 8000;
            riposteP = p;

            backX = reachedBackX;
            frontX = reachedFrontX + (Math.min(1, p * 1.5) * 24);
            pelvisOffset = -retreatDist + (Math.min(1, p * 1.5) * 12);
        } else {
            const p = (t - 23000) / 7000;
            pelvisOffset = -retreatDist + (p * retreatDist);
            frontX = startX + baseStance / 2 + pelvisOffset;
            backX = startX - baseStance / 2 + pelvisOffset;
            oppAttackP = 1 - p; riposteP = 1 - p;
        }

        const currentRivaX = startX + pelvisOffset;
        const rivaGuardX = currentRivaX + 10 + 24;
        const rivaGuardY = 224;

        const oppBaseRearX = 490;
        const oppAdvanceDist = 38;
        let oppEffectiveRearX, oppPelvisX;

        if (oppAttackP < 0.35) {
            const advP = oppAttackP / 0.35;
            oppEffectiveRearX = oppBaseRearX - (advP * oppAdvanceDist);
            oppPelvisX = oppEffectiveRearX - 24;
        } else {
            const lungeSubP = (oppAttackP - 0.35) / 0.65;
            oppEffectiveRearX = oppBaseRearX - oppAdvanceDist;
            oppPelvisX = (oppEffectiveRearX - 24) - (lungeSubP * 38);
        }

        const oppChestX = oppPelvisX - 18;
        const oppChestY = 226;

        drawOpponentFencer(oppBaseRearX, GROUND_Y, oppAttackP, rivaParryP, riposteP, false, rivaGuardX, rivaGuardY);

        const lateralAngle = riposteP > 0 ? -1.0 : (-2.0 - (rivaParryP * 2.0));
        const physicalTargetX = riposteP > 0.68 ? oppChestX : 0;

        drawU10Fencer({
            pelvisX: currentRivaX, pelvisY: 254,
            frontFootX: frontX, frontFootY: frontY, frontTilt: frontTilt,
            rearFootX: backX, rearFootY: backY, rearTilt: rearTilt,
            rearFootTurned90: true,
            armState: riposteP > 0 ? 'attack' : 'enGarde',
            armExtension: riposteP,
            bladeAngle: lateralAngle,
            targetSurfaceX: physicalTargetX,
            targetSurfaceY: oppChestY,
            isFlankHit: false,
            gazeTargetX: oppChestX,
            gazeTargetY: oppChestY
        });
    }

    function renderDrill8_Parry6(t) {
        drawFencingStrip(GROUND_Y);
        clearErrorZones();

        const baseStance = 48;
        const retreatDist = 28;
        const startX = 230;

        let frontX = startX + baseStance / 2;
        let backX = startX - baseStance / 2;
        let frontTilt = 0, rearTilt = 0, frontY = GROUND_Y, backY = GROUND_Y;
        let pelvisOffset = 0;
        let oppAttackP = 0, rivaParryP = 0, riposteP = 0;

        if (t < 6000) {
        } else if (t < 15000) {
            const p = (t - 6000) / 9000;
            oppAttackP = p;
            rivaParryP = p;

            if (p < 0.5) {
                const subP = p / 0.5;
                frontX = startX + baseStance / 2;
                backX = (startX - baseStance / 2) - (subP * retreatDist);
                rearTilt = 18 * Math.sin(subP * Math.PI);
                backY = GROUND_Y - (4.0 * Math.sin(subP * Math.PI));
                pelvisOffset = -(subP * (retreatDist * 0.5));
            } else {
                const subP = (p - 0.5) / 0.5;
                backX = (startX - baseStance / 2) - retreatDist;
                frontX = (startX + baseStance / 2) - (subP * retreatDist);
                frontTilt = -14 * Math.sin(subP * Math.PI);
                frontY = GROUND_Y - (3.5 * Math.sin(subP * Math.PI));
                pelvisOffset = -(retreatDist * 0.5) - (subP * retreatDist * 0.5);
            }
        } else if (t < 23000) {
            oppAttackP = 1;
            const reachedBackX = startX - baseStance / 2 - retreatDist;
            const reachedFrontX = startX + baseStance / 2 - retreatDist;
            const p = (t - 15000) / 8000;
            riposteP = p;

            backX = reachedBackX;
            frontX = reachedFrontX + (Math.min(1, p * 1.5) * 24);
            pelvisOffset = -retreatDist + (Math.min(1, p * 1.5) * 12);
        } else {
            const p = (t - 23000) / 7000;
            pelvisOffset = -retreatDist + (p * retreatDist);
            frontX = startX + baseStance / 2 + pelvisOffset;
            backX = startX - baseStance / 2 + pelvisOffset;
            oppAttackP = 1 - p; riposteP = 1 - p;
        }

        const currentRivaX = startX + pelvisOffset;
        const rivaGuardX = currentRivaX + 10 + 24;
        const rivaGuardY = 224;

        const oppBaseRearX = 490;
        const oppAdvanceDist = 38;
        let oppEffectiveRearX, oppPelvisX;

        if (oppAttackP < 0.35) {
            const advP = oppAttackP / 0.35;
            oppEffectiveRearX = oppBaseRearX - (advP * oppAdvanceDist);
            oppPelvisX = oppEffectiveRearX - 24;
        } else {
            const lungeSubP = (oppAttackP - 0.35) / 0.65;
            oppEffectiveRearX = oppBaseRearX - oppAdvanceDist;
            oppPelvisX = (oppEffectiveRearX - 24) - (lungeSubP * 38);
        }

        const oppFlankX = oppPelvisX - 18;
        const oppFlankY = 232;

        drawOpponentFencer(oppBaseRearX, GROUND_Y, oppAttackP, rivaParryP, riposteP, true, rivaGuardX, rivaGuardY);

        const lateralAngle = riposteP > 0 ? 2.5 : (-2.0 + (rivaParryP * 4.0));
        const physicalTargetX = riposteP > 0.68 ? oppFlankX : 0;

        drawU10Fencer({
            pelvisX: currentRivaX, pelvisY: 254,
            frontFootX: frontX, frontFootY: frontY, frontTilt: frontTilt,
            rearFootX: backX, rearFootY: backY, rearTilt: rearTilt,
            rearFootTurned90: true,
            armState: riposteP > 0 ? 'attack' : 'enGarde',
            armExtension: riposteP,
            bladeAngle: lateralAngle,
            targetSurfaceX: physicalTargetX,
            targetSurfaceY: oppFlankY,
            isFlankHit: true,
            gazeTargetX: oppFlankX,
            gazeTargetY: oppFlankY
        });
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
                badgeText.innerText = `Drill #1 (${currentDrill + 1}/8)`;
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
    // ANIMATION LOOP (IN-CANVAS CLOCK REMOVED)
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
                currentDrill = (currentDrill + 1) % 8;
                currentSubPhase = -1;
            }

            updateDrillStateMachine(effectiveElapsed);
        }

        ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        applyCameraTransform();

        if (currentDrill === 0) renderDrill1_LStance(effectiveElapsed);
        else if (currentDrill === 1) renderDrill2_EnGarde(effectiveElapsed);
        else if (currentDrill === 2) renderDrill3_StepSequence(effectiveElapsed);
        else if (currentDrill === 3) renderDrill4_LaserTip(effectiveElapsed);
        else if (currentDrill === 4) renderDrill5_BasicAttack(effectiveElapsed);
        else if (currentDrill === 5) renderDrill6_Lunge(effectiveElapsed);
        else if (currentDrill === 6) renderDrill7_Parry4(effectiveElapsed);
        else if (currentDrill === 7) renderDrill8_Parry6(effectiveElapsed);

        drawActiveErrorReticles();
        updateAndDrawRipples();
        restoreCameraTransform();

        requestAnimationFrame(render);
    }

    render();

    // -------------------------------------------------------------
    // EXPORTED MASTER SHELL INTERFACE
    // -------------------------------------------------------------
    window.RivaCartridge = {
        init: () => {
            initAudio();
            isPaused = false;
            effectiveElapsed = 0;
            currentDrill = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        restart: () => {
            stopAllSpeech();
            initAudio();
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
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
            currentDrill = Math.max(0, Math.min(7, idx));
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        nextSubDrill: () => {
            stopAllSpeech();
            currentDrill = (currentDrill + 1) % 8;
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
            lastFrameTime = performance.now();
            updateDrillStateMachine(0);
        },
        prevSubDrill: () => {
            stopAllSpeech();
            currentDrill = (currentDrill - 1 + 8) % 8;
            effectiveElapsed = 0;
            currentSubPhase = -1;
            currentPlaybackSpeed = 1.0;
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
