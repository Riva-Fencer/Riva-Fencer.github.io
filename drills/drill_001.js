/**
 * Riva Fencer - Cartridge 001
 * Exact Original Biomechanics & IK from Riva Drill 1.html
 */
(function () {
    let ctx, BASE_WIDTH = 820, BASE_HEIGHT = 420, GROUND_Y = 312;
    let animFrameId = null;
    let isPaused = true;
    let effectiveElapsed = 0;
    let lastFrameTime = performance.now();
    const DRILL_DURATION = 30000;

    // -------------------------------------------------------------
    // WEAKNESS 1: SPATIAL HIT-TESTING & ERROR RETICLE REGISTRY
    // -------------------------------------------------------------
    let activeErrorZones = [];
    let visualRipples = [];

    function registerErrorZone(id, x, y, radius, onCorrectCallback) {
        activeErrorZones.push({ id, x, y, radius, onCorrect: onCorrectCallback });
    }

    function clearErrorZones() {
        activeErrorZones = [];
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
    // WEAKNESS 2: HIT-STOP & DYNAMIC SCREEN SHAKE ENGINE
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
    // INVERSE KINEMATICS & ANATOMICAL RENDERING (YOUR ORIGINAL CODE)
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

        // 1. Femur / Thigh with Quadriceps Muscle Form
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

        // 2. Tibia / Calf with Gastrocnemius Contour
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

        // 3. Patella Cap
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

        // 1. REAR LEG IK
        const rearHipX = pelvisX - 5;
        const rearHipY = pelvisY;
        const rearAnkleY = rearFootY - 6;
        const rearIK = solveLegIK(rearHipX, rearHipY, rearFootX, rearAnkleY, femur, tibia, false);
        drawAnatomicalContouredLeg(rearHipX, rearHipY, rearIK.kx, rearIK.ky, rearFootX, rearAnkleY, false);
        drawAuthenticShoe(rearFootX, rearFootY, rearTilt, false, rearFootTurned90, false);

        // 2. FRONT LEG IK
        const frontHipX = pelvisX + 5;
        const frontHipY = pelvisY;
        const frontAnkleY = frontFootY - 6;
        const frontIK = solveLegIK(frontHipX, frontHipY, frontFootX, frontAnkleY, femur, tibia, true);
        drawAnatomicalContouredLeg(frontHipX, frontHipY, frontIK.kx, frontIK.ky, frontFootX, frontAnkleY, true);
        drawAuthenticShoe(frontFootX, frontFootY, frontTilt, true, false, false);

        // 3. TORSO & CONDUCTIVE LAMÉ
        const shoulderX = pelvisX + 3 + (torsoIncline * 10);
        const shoulderY = pelvisY - 50;

        ctx.save();
        ctx.fillStyle = isError ? '#fca5a5' : '#f1f5f9';
        ctx.beginPath();
        ctx.roundRect(pelvisX - 9, pelvisY - 4, 18, 9, [2, 2, 3, 3]);
        ctx.fill();
        ctx.restore();

        drawFoilLameVest(pelvisX, pelvisY, shoulderX, shoulderY, false, isError);

        // 4. COUNTERBALANCE REAR ARM
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

        // 5. HEAD & AUTHENTIC MASK
        const headX = shoulderX + 3;
        const headY = shoulderY - 18;
        drawAuthenticMask(headX, headY, gazeTargetX, gazeTargetY, false, isError);

        // 6. WEAPON ARM & FOIL
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

    // -------------------------------------------------------------
    // EXACT DRILL 1 ANIMATION ROUTINE
    // -------------------------------------------------------------
    const PHASES = [
        { startTime: 0, marathiText: "दोन्ही पावले जवळ ठेवा आणि सरळ उभे राहा.", englishText: "Stand upright with both feet together.", status: "१. दोन्ही पावले जवळ जोडून ताठ उभे राहा. (लाल त्रुटीवर टॅप करा)", color: "#ef4444" },
        { startTime: 9000, marathiText: "मागचा पाय नव्वद अंशात फिरवून एल आकार बनवा.", englishText: "Turn the rear foot 90 degrees to form an L.", status: "२. पुढचा पाय सरळ ठेवून, मागचा पाय ९० अंशात फिरवा ('L' आकार)!", color: "#facc15" },
        { startTime: 18000, marathiText: "शाब्बास रीवा, अचूक एल पोझिशन तयार झाली आहे!", englishText: "Excellent Riva, perfect L-stance base achieved!", status: "✅ अचूक 'L' कोन आणि खांद्याइतके नैसर्गिक अंतर पूर्ण!", color: "#22c55e" }
    ];

    let currentPhaseIdx = -1;

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

    function updateStateMachine(t) {
        let targetIdx = 0;
        for (let i = PHASES.length - 1; i >= 0; i--) {
            if (t >= PHASES[i].startTime) {
                targetIdx = i;
                break;
            }
        }

        if (currentPhaseIdx !== targetIdx) {
            currentPhaseIdx = targetIdx;
            const p = PHASES[targetIdx];
            const statusBox = document.getElementById('status-box');
            if (statusBox) {
                statusBox.innerText = typeof getPersonalizedText === 'function' ? getPersonalizedText(p.status) : p.status;
                statusBox.style.color = p.color;
            }
            if (typeof speakCoachingCue === 'function') {
                speakCoachingCue(p.marathiText, p.englishText);
            }
        }

        // Timer HUD in Master Shell
        const remainingSec = Math.max(0, Math.ceil((DRILL_DURATION - t) / 1000));
        const timerNum = document.getElementById('timer-number');
        if (timerNum) timerNum.innerText = `${remainingSec}s`;

        const timerProgress = document.getElementById('timerProgress');
        if (timerProgress) {
            const pct = Math.min(100, (t / DRILL_DURATION) * 100);
            timerProgress.setAttribute('stroke-dashoffset', 100 - pct);
        }
    }

    function loop() {
        if (isPaused) return;

        const now = performance.now();
        const dt = now - lastFrameTime;
        lastFrameTime = now;

        if (now >= hitStopUntil) {
            effectiveElapsed = (effectiveElapsed + dt) % DRILL_DURATION;
            updateStateMachine(effectiveElapsed);
        }

        ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        applyCameraTransform();

        renderDrill1_LStance(effectiveElapsed);

        drawActiveErrorReticles();
        updateAndDrawRipples();
        restoreCameraTransform();

        animFrameId = requestAnimationFrame(loop);
    }

    // -------------------------------------------------------------
    // CARTRIDGE PUBLIC API
    // -------------------------------------------------------------
    function init(canvasCtx, w, h, gY) {
        ctx = canvasCtx;
        BASE_WIDTH = w;
        BASE_HEIGHT = h;
        GROUND_Y = gY;
        restart();
    }

    function restart() {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        effectiveElapsed = 0;
        currentPhaseIdx = -1;
        lastFrameTime = performance.now();
        isPaused = false;
        loop();
    }

    function setPaused(paused) {
        if (isPaused === paused) return;
        isPaused = paused;
        if (!isPaused) {
            lastFrameTime = performance.now();
            loop();
        } else {
            if (animFrameId) cancelAnimationFrame(animFrameId);
        }
    }

    function handleTap(clickX, clickY) {
        resolveErrorCorrectionTap(clickX, clickY);
    }

    window.RivaCartridge = {
        init: init,
        restart: restart,
        setPaused: setPaused,
        handleTap: handleTap
    };
})();
