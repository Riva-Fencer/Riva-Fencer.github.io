/**
 * Riva Fencer - Cartridge 001
 * Drill 1: पायांची अचूक 'L' पोझिशन व तोल (L-Stance & Balance)
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

    const PHASES = [
        {
            start: 0,
            end: 9,
            text: "पायांमध्ये ९० अंशाचा अचूक 'L' आकार ठेवा",
            cue: "शाब्बास रीवा, दोन्ही पायांमध्ये नव्वद अंशाचा अचूक एल आकार तयार करा!",
            target: { x: 380, y: 295, r: 28, label: "टाच जुळवा" }
        },
        {
            start: 9,
            end: 18,
            text: "गुडघे थोडे वाकवा (En Garde Stance)",
            cue: "गुडघे हलके वाकवा, पाठीचा कणा ताठ ठेवा!",
            target: { x: 440, y: 230, r: 24, label: "गुडघा वाकवा" }
        },
        {
            start: 18,
            end: 30,
            text: "तोल मध्यभागी ठेवा आणि स्थिर राहा",
            cue: "उत्कृष्ट! शरीराचा तोल दोन्ही पायांवर समान ठेवा.",
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
                speakCoachingCue("अचूक दुरुस्ती!");
            }
        }
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

        if (elapsedSec >= DURATION) {
            const statusBox = document.getElementById('status-box');
            if (statusBox) statusBox.innerText = "सराव पूर्ण! शाब्बास!";
            if (typeof speakCoachingCue === 'function' && currentPhase !== 99) {
                speakCoachingCue("शाब्बास रीवा, आजचा सराव पूर्ण झाला!");
                currentPhase = 99;
            }
        }
    }

    function drawPiste() {
        ctx.fillStyle = "#090d16";
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(40, groundY);
        ctx.lineTo(W - 40, groundY);
        ctx.stroke();

        for (let x = 120; x <= W - 120; x += 80) {
            ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
            ctx.beginPath();
            ctx.moveTo(x, groundY - 6);
            ctx.lineTo(x, groundY + 6);
            ctx.stroke();
        }
    }

    function drawFencer(elapsedSec) {
        const rootX = 400;
        const rootY = groundY;
        const isBending = elapsedSec >= 9;

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const frontFootX = rootX + 55;
        const frontKneeX = isBending ? rootX + 40 : rootX + 30;
        const frontKneeY = isBending ? rootY - 45 : rootY - 55;
        const hipY = isBending ? rootY - 105 : rootY - 120;

        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(rootX + 15, hipY);
        ctx.lineTo(frontKneeX, frontKneeY);
        ctx.lineTo(frontFootX, rootY);
        ctx.lineTo(frontFootX + 25, rootY);
        ctx.stroke();

        const backKneeX = isBending ? rootX - 35 : rootX - 25;
        const backKneeY = isBending ? rootY - 45 : rootY - 55;
        const backFootX = rootX - 45;

        ctx.strokeStyle = "#0284c7";
        ctx.beginPath();
        ctx.moveTo(rootX - 15, hipY);
        ctx.lineTo(backKneeX, backKneeY);
        ctx.lineTo(backFootX, rootY);
        ctx.stroke();

        ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(backFootX, rootY);
        ctx.lineTo(rootX + 10, rootY);
        ctx.lineTo(frontFootX + 25, rootY);
        ctx.stroke();

        const chestX = rootX;
        const chestY = hipY - 55;
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(rootX, hipY);
        ctx.lineTo(chestX, chestY);
        ctx.stroke();

        ctx.fillStyle = "#1e293b";
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(chestX, chestY - 24, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(chestX + 6, chestY - 34);
        ctx.lineTo(chestX + 6, chestY - 14);
        ctx.stroke();

        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 5;
        const elbowX = chestX + 28;
        const elbowY = chestY + 12;
        const handX = chestX + 65;
        const handY = chestY - 5;

        ctx.beginPath();
        ctx.moveTo(chestX + 10, chestY - 10);
        ctx.lineTo(elbowX, elbowY);
        ctx.lineTo(handX, handY);
        ctx.stroke();

        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(handX, handY);
        ctx.lineTo(handX + 110, handY - 12);
        ctx.stroke();

        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(chestX - 10, chestY - 10);
        ctx.lineTo(chestX - 35, chestY - 25);
        ctx.lineTo(chestX - 30, chestY - 50);
        ctx.stroke();

        ctx.restore();
    }

    function drawReticle() {
        if (!targetReticle) return;
        ctx.save();
        const { x, y, r, clicked, label } = targetReticle;

        ctx.strokeStyle = clicked ? "#22c55e" : "#ef4444";
        ctx.fillStyle = clicked ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.15)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = clicked ? "#86efac" : "#fca5a5";
        ctx.font = "bold 12px Mukta, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(clicked ? "✓ बरोबर" : label, x, y - r - 6);

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
