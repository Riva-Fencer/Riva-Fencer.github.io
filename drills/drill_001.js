/**
 * Riva Fencer - Cartridge 001
 * Drill 1: पायांची अचूक 'L' पोझिशन व तोल (L-Stance & Dynamic En Garde)
 */
(function () {
    let ctx, W, H, groundY;
    let animFrameId = null;
    let isPaused = true;
    let startTime = 0;
    let pausedAt = 0;
    const DURATION = 30;

    let currentPhase = -1;
    let targetReticle = null;

    // Timeline configuration
    const PHASES = [
        {
            start: 0,
            end: 9,
            text: "पायांमध्ये ९० अंशाचा अचूक 'L' आकार तयार करा",
            cue: "शाब्बास रीवा, पायांमध्ये नव्वद अंशाचा अचूक एल आकार तयार करा!",
            target: { x: 390, y: 312, r: 32, label: "टाच जुळवा (९०°)" }
        },
        {
            start: 9,
            end: 18,
            text: "गुडघे वाकवून खोल एन गार्डे पोझिशन घ्या",
            cue: "गुडघे वाकवा, पाठीचा कणा ताठ ठेवून एन गार्डे पोझिशन घ्या!",
            target: { x: 470, y: 245, r: 28, label: "गुडघा वाकवा" }
        },
        {
            start: 18,
            end: 30,
            text: "तोल ५०-५० मध्यभागी ठेवा आणि स्थिर राहा",
            cue: "उत्कृष्ट! शरीराचा तोल मध्यभागी ठेवून स्थिर राहा.",
            target: null
        }
    ];

    function init(canvasCtx, baseWidth, baseHeight, baseGroundY) {
        ctx = canvasCtx;
        W = baseWidth;
        H = baseHeight;
        groundY = baseGroundY;
        restart();
    }

    function restart() {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        startTime = performance.now();
        pausedAt = 0;
        isPaused = false;
        currentPhase = -1;
        targetReticle = null;
        loop();
    }

    function setPaused(paused) {
        if (isPaused === paused) return;
        isPaused = paused;
        if (isPaused) {
            pausedAt = performance.now() - startTime;
            if (animFrameId) cancelAnimationFrame(animFrameId);
        } else {
            startTime = performance.now() - pausedAt;
            loop();
        }
    }

    function handleTap(clickX, clickY) {
        if (!targetReticle || targetReticle.clicked) return;
        const dx = clickX - targetReticle.x;
        const dy = clickY - targetReticle.y;
        if (Math.hypot(dx, dy) <= targetReticle.r * 1.5) {
            targetReticle.clicked = true;
            if (typeof speakCoachingCue === 'function') {
                speakCoachingCue("अचूक! खूप छान.");
            }
        }
    }

    function easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    function updateHUD(elapsedSec) {
        const remaining = Math.max(0, Math.ceil(DURATION - elapsedSec));
        const timerNum = document.getElementById('timer-number');
        if (timerNum) timerNum.innerText = `${remaining}s`;

        const timerProgress = document.getElementById('timerProgress');
        if (timerProgress) {
            const pct = Math.min(100, (elapsedSec / DURATION) * 100);
            timerProgress.setAttribute('stroke-dashoffset', 100 - pct);
        }

        for (let i = 0; i < PHASES.length; i++) {
            const p = PHASES[i];
            if (elapsedSec >= p.start && elapsedSec < p.end) {
                if (currentPhase !== i) {
                    currentPhase = i;
                    targetReticle = p.target ? { ...p.target, clicked: false } : null;
                    const statusBox = document.getElementById('status-box');
                    if (statusBox) statusBox.innerText = getPersonalizedText(p.text);
                    if (typeof speakCoachingCue === 'function') speakCoachingCue(p.cue);
                }
                break;
            }
        }

        if (elapsedSec >= DURATION && currentPhase !== 99) {
            const statusBox = document.getElementById('status-box');
            if (statusBox) statusBox.innerText = "सराव यशस्वीरीत्या पूर्ण! शाब्बास!";
            if (typeof speakCoachingCue === 'function') {
                speakCoachingCue("शाब्बास रीवा, अचूक पोझिशन! आजचा सराव पूर्ण झाला.");
            }
            currentPhase = 99;
        }
    }

    function drawPiste() {
        // High-tech dark metallic piste surface
        const grad = ctx.createLinearGradient(0, groundY - 10, 0, H);
        grad.addColorStop(0, "#0a1120");
        grad.addColorStop(1, "#040711");
        ctx.fillStyle = grad;
        ctx.fillRect(0, groundY, W, H - groundY);

        // Strip borders with athletic cyan glow
        ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(30, groundY);
        ctx.lineTo(W - 30, groundY);
        ctx.stroke();

        // Strip grid marks
        for (let x = 70; x <= W - 70; x += 60) {
            ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, groundY - 4);
            ctx.lineTo(x, groundY + 8);
            ctx.stroke();
        }
    }

    function drawFencer(elapsedSec) {
        // Compute smooth stance progression
        let squatT = 0;
        if (elapsedSec < 9) {
            squatT = 0; // Standing upright in L-Stance
        } else if (elapsedSec < 12) {
            squatT = easeInOutQuad((elapsedSec - 9) / 3); // Sinking smoothly into En Garde
        } else {
            squatT = 1; // Locked deep En Garde stance
        }

        // Natural athletic breathing sway
        const sway = Math.sin(elapsedSec * 3) * (squatT > 0.8 ? 1.5 : 0.8);

        // Core Biomechanical Coordinates
        const rootX = 390;
        const hipDrop = squatT * 38;
        const hipY = (groundY - 145) + hipDrop + sway;

        const frontFootX = rootX + 75 + (squatT * 28);
        const frontFootY = groundY;
        const rearFootX = rootX - 60;
        const rearFootY = groundY;

        // Dynamic Knee Interpolation
        const frontKneeX = rootX + 45 + (squatT * 36);
        const frontKneeY = hipY + 58 + (squatT * 12);

        const rearKneeX = rootX - 35 - (squatT * 8);
        const rearKneeY = hipY + 56 + (squatT * 14);

        // Ambient Contact Shadows
        const drawShadow = (x, y, radiusX, radiusY) => {
            ctx.save();
            const shadowGrad = ctx.createRadialGradient(x, y, 2, x, y, radiusX);
            shadowGrad.addColorStop(0, "rgba(0, 0, 0, 0.65)");
            shadowGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = shadowGrad;
            ctx.beginPath();
            ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        };

        drawShadow(rearFootX + 8, groundY + 2, 28, 7);
        drawShadow(frontFootX + 10, groundY + 2, 32, 7);
        drawShadow(rootX + 15, groundY + 2, 65, 10); // Core body shadow

        // 1. 90-Degree Floor Alignment Graphic
        ctx.save();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "rgba(250, 204, 21, 0.85)";
        ctx.fillStyle = "rgba(250, 204, 21, 0.15)";

        ctx.beginPath();
        ctx.moveTo(rearFootX, groundY);
        ctx.lineTo(rearFootX + 45, groundY);
        ctx.lineTo(rearFootX + 45, groundY - 40);
        ctx.stroke();

        // 90-degree corner square symbol
        ctx.fillRect(rearFootX + 33, groundY - 12, 12, 12);
        ctx.strokeRect(rearFootX + 33, groundY - 12, 12, 12);

        ctx.fillStyle = "#fde047";
        ctx.font = "700 11px 'Plus Jakarta Sans', sans-serif";
        ctx.fillText("90° L-STANCE", rearFootX - 10, groundY + 20);
        ctx.restore();

        // 2. Center of Gravity Balance Line (Active in Phase 3)
        if (elapsedSec >= 18) {
            ctx.save();
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(rootX + 12, hipY - 60);
            ctx.lineTo(rootX + 12, groundY);
            ctx.stroke();

            ctx.fillStyle = "#38bdf8";
            ctx.font = "700 10px 'Plus Jakarta Sans', sans-serif";
            ctx.fillText("50% / 50% BALANCE", rootX - 40, groundY - 8);
            ctx.restore();
        }

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // 3. Rear Leg (Breeches, Knee, Calf, and Foot)
        // Thigh
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 15;
        ctx.beginPath();
        ctx.moveTo(rootX - 6, hipY + 8);
        ctx.lineTo(rearKneeX, rearKneeY);
        ctx.stroke();

        // Lower Leg / Shin
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 13;
        ctx.beginPath();
        ctx.moveTo(rearKneeX, rearKneeY);
        ctx.lineTo(rearFootX + 8, rearFootY - 6);
        ctx.stroke();

        // Rear Fencing Shoe (Side View Profile)
        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.roundRect(rearFootX - 12, rearFootY - 8, 38, 10, 3);
        ctx.fill();
        ctx.fillStyle = "#38bdf8";
        ctx.fillRect(rearFootX - 10, rearFootY - 2, 34, 3); // Blue sole grip

        // 4. Front Leg (Lead Stance toward Opponent)
        // Thigh
        ctx.strokeStyle = "#f1f5f9";
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.moveTo(rootX + 12, hipY + 8);
        ctx.lineTo(frontKneeX, frontKneeY);
        ctx.stroke();

        // Lower Leg / Front Calf
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(frontKneeX, frontKneeY);
        ctx.lineTo(frontFootX, frontFootY - 6);
        ctx.stroke();

        // Front Fencing Shoe (Pointing straight at adversary)
        ctx.fillStyle = "#0f172a";
        ctx.beginPath();
        ctx.moveTo(frontFootX - 12, frontFootY - 8);
        ctx.lineTo(frontFootX + 28, frontFootY - 8);
        ctx.lineTo(frontFootX + 32, frontFootY - 1);
        ctx.lineTo(frontFootX - 12, frontFootY - 1);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#38bdf8";
        ctx.fillRect(frontFootX - 10, frontFootY - 2, 40, 3); // Shoe outsole

        // 5. Torso & Fencing Jacket (Plastron)
        const spineAngle = 0.04;
        const chestX = rootX + 4 + (squatT * 3);
        const chestY = hipY - 65;

        // Fencing jacket body
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rootX - 18, hipY + 12);
        ctx.lineTo(rootX + 26, hipY + 12);
        ctx.lineTo(chestX + 24, chestY);
        ctx.lineTo(chestX - 22, chestY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Tournament plastron / harness line
        ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(chestX - 14, chestY + 6);
        ctx.lineTo(rootX + 16, hipY + 10);
        ctx.stroke();

        // 6. Non-Sword Trailing Arm (High Counter-Balance Arc)
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 8;
        const rearShoulderX = chestX - 18;
        const rearShoulderY = chestY + 6;
        const rearElbowX = rearShoulderX - 28;
        const rearElbowY = rearShoulderY - 26;
        const rearHandX = rearElbowX + 6;
        const rearHandY = rearElbowY - 34;

        ctx.beginPath();
        ctx.moveTo(rearShoulderX, rearShoulderY);
        ctx.lineTo(rearElbowX, rearElbowY);
        ctx.lineTo(rearHandX, rearHandY);
        ctx.stroke();

        // Trailing hand
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(rearHandX, rearHandY, 5.5, 0, Math.PI * 2);
        ctx.fill();

        // 7. Head, Collar & Fencing Mask
        const headCenterX = chestX + 2;
        const headCenterY = chestY - 34;

        // White neck bib (Protective collar)
        ctx.fillStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.moveTo(headCenterX - 14, headCenterY + 14);
        ctx.lineTo(headCenterX + 14, headCenterY + 14);
        ctx.lineTo(headCenterX + 18, headCenterY + 28);
        ctx.lineTo(headCenterX - 18, headCenterY + 28);
        ctx.closePath();
        ctx.fill();

        // Fencing mask oval base
        ctx.save();
        ctx.translate(headCenterX, headCenterY);
        ctx.rotate(0.08); // Slight forward gaze angle

        ctx.fillStyle = "#0f172a";
        ctx.beginPath();
        ctx.ellipse(0, 0, 19, 26, 0, 0, Math.PI * 2);
        ctx.fill();

        // Stainless wire mesh pattern inside mask
        ctx.strokeStyle = "rgba(56, 189, 248, 0.3)";
        ctx.lineWidth = 1;
        for (let gridX = -14; gridX <= 14; gridX += 4) {
            ctx.beginPath();
            ctx.moveTo(gridX, -22);
            ctx.lineTo(gridX, 22);
            ctx.stroke();
        }
        for (let gridY = -20; gridY <= 20; gridY += 4) {
            ctx.beginPath();
            ctx.moveTo(-15, gridY);
            ctx.lineTo(15, gridY);
            ctx.stroke();
        }

        // Mask outer protective trim & gloss highlight
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, 19, 26, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(6, -8, 12, -Math.PI / 3, Math.PI / 4);
        ctx.stroke();
        ctx.restore();

        // 8. Lead Sword Arm & Foil En Garde
        const leadShoulderX = chestX + 18;
        const leadShoulderY = chestY + 8;
        const leadElbowX = leadShoulderX + 32;
        const leadElbowY = leadShoulderY + 28 - (squatT * 6);
        const leadHandX = leadElbowX + 38;
        const leadHandY = leadElbowY - 14;

        // Glove and forearm
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(leadShoulderX, leadShoulderY);
        ctx.lineTo(leadElbowX, leadElbowY);
        ctx.lineTo(leadHandX, leadHandY);
        ctx.stroke();

        // Glove Cuff (Manchette)
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(leadHandX - 10, leadHandY - 4);
        ctx.lineTo(leadHandX - 4, leadHandY + 8);
        ctx.stroke();

        // Foil Bell Guard (Coquille)
        ctx.save();
        const guardGrad = ctx.createRadialGradient(leadHandX, leadHandY, 2, leadHandX, leadHandY, 14);
        guardGrad.addColorStop(0, "#ffffff");
        guardGrad.addColorStop(0.5, "#94a3b8");
        guardGrad.addColorStop(1, "#334155");
        ctx.fillStyle = guardGrad;
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(leadHandX, leadHandY, 8, 16, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Steel Foil Blade
        const bladeTipX = leadHandX + 160;
        const bladeTipY = leadHandY - 12;

        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(leadHandX + 4, leadHandY);
        ctx.lineTo(bladeTipX, bladeTipY);
        ctx.stroke();

        // Rubber Foil Tip Button (Pointe d'arrêt)
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(bladeTipX, bladeTipY, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        ctx.restore();
    }

    function drawReticle() {
        if (!targetReticle) return;
        ctx.save();
        const { x, y, r, clicked, label } = targetReticle;

        ctx.strokeStyle = clicked ? "#22c55e" : "#ef4444";
        ctx.fillStyle = clicked ? "rgba(34, 197, 94, 0.22)" : "rgba(239, 68, 68, 0.16)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 5]);

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = clicked ? "#86efac" : "#fca5a5";
        ctx.font = "bold 13px Mukta, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(clicked ? "✓ उत्तम (अचूक)" : label, x, y - r - 8);

        ctx.restore();
    }

    function loop() {
        if (isPaused) return;

        const elapsedSec = (performance.now() - startTime) / 1000;
        updateHUD(elapsedSec);

        ctx.clearRect(0, 0, W, H);
        drawPiste();
        drawFencer(elapsedSec);
        drawReticle();

        if (elapsedSec < DURATION) {
            animFrameId = requestAnimationFrame(loop);
        }
    }

    window.RivaCartridge = {
        init: init,
        restart: restart,
        setPaused: setPaused,
        handleTap: handleTap
    };
})();
