/**
 * Riva Fencer - Tab 3: Kinetic Video Clinic (तपासणी)
 * Release #2: Full End-to-End Pipeline (Phases 1, 2, 3, and 4)
 * 100% Client-Side, Zero Image Memory Leaks, 15 FPS Coordinate Buffer.
 */

(function () {
    let container = null;
    let videoElement = null;
    let canvasOverlay = null;
    let canvasCtx = null;
    let mediaStream = null;
    let poseLandmarker = null;

    let countdownTimer = null;
    let isRunning = false;
    let currentPhase = 'INIT'; // 'INIT', 'STANCE_COUNTDOWN', 'STANCE_AUDIT', 'LUNGE_TRACKING', 'REPORT'

    // Calibration Baselines (Phase 2 Output)
    let baselineData = {
        isRightFacing: true,
        shoulderWidth: 100,
        stanceWidth: 150,
        leadAnkleBaselineY: 0,
        rearAnkleBaselineY: 0,
        stanceStars: 3,
        guardStars: 3
    };

    // Phase 3 Dynamic Buffers (~30 KB total RAM footprint)
    const MAX_BUFFER_FRAMES = 75; // 5 seconds at 15 FPS
    let coordinateBuffer = []; // [{ t: timestamp, lm: [...] }]
    let lastFrameTime = 0;
    let animFrameId = null;

    // Retrospective Snapshot Ring Buffer (2 frames to beat inference latency)
    let snapshotCanvasA = null;
    let snapshotCanvasB = null;
    let snapshotCtxA = null;
    let snapshotCtxB = null;
    let activeSnapshotSlot = 0;

    // -------------------------------------------------------------
    // 1. AUDIO SYNTHESIS & PRIMING
    // -------------------------------------------------------------
    function primeSpeechAudio() {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
        }
    }

    function speakCoachingCue(marathiText) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();

        const athlete = JSON.parse(localStorage.getItem('riva_athlete')) || { name: 'रीवा' };
        const customizedText = marathiText.replaceAll('रीवा', athlete.name);

        const utterance = new SpeechSynthesisUtterance(customizedText);
        const voices = window.speechSynthesis.getVoices() || [];
        const mrVoice = voices.find(v => v.lang.toLowerCase().includes('mr')) ||
                        voices.find(v => v.lang.toLowerCase().includes('hi')) || null;
        if (mrVoice) utterance.voice = mrVoice;
        utterance.lang = mrVoice && mrVoice.lang.includes('hi') ? 'hi-IN' : 'mr-IN';
        utterance.rate = 0.90;
        window.speechSynthesis.speak(utterance);
    }

    // -------------------------------------------------------------
    // 2. OFFLINE MEDIAPIPE LOADER
    // -------------------------------------------------------------
    async function initMediaPipePose() {
        if (poseLandmarker) return poseLandmarker;

        const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
        const { FilesetResolver, PoseLandmarker } = vision;
        const fileset = await FilesetResolver.forVisionTasks('./models');

        poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: {
                modelAssetPath: './models/pose_landmarker_lite.task',
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numPoses: 1
        });

        return poseLandmarker;
    }

    // -------------------------------------------------------------
    // 3. VIEWPORT INITIALIZATION
    // -------------------------------------------------------------
    function buildClinicDOM() {
        container = document.getElementById('clinicStageContainer') || document.getElementById('sparrerPlaceholderView');
        if (!container) return;

        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.padding = '8px 12px 64px';
        container.style.backgroundColor = '#070a12';

        container.innerHTML = `
            <style>
                .clinic-viewport {
                    position: relative;
                    width: 100%;
                    max-width: 640px;
                    aspect-ratio: 4 / 3;
                    border-radius: 16px;
                    overflow: hidden;
                    background: #000;
                    border: 1.5px solid #334155;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.7);
                }
                .clinic-video-feed { width: 100%; height: 100%; object-fit: cover; }
                .clinic-canvas-layer { position: absolute; inset: 0; width: 100%; height: 100%; }
                .clinic-countdown-badge {
                    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
                    background: rgba(15, 23, 42, 0.88); border: 1.5px solid #38bdf8;
                    padding: 5px 16px; border-radius: 999px; font-size: 16px;
                    font-weight: 800; color: #facc15; backdrop-filter: blur(6px); z-index: 10;
                }
                .clinic-banner-bar {
                    width: 100%; max-width: 640px; background: #0f172a;
                    border: 1px solid #1e293b; border-radius: 12px; padding: 10px 14px;
                    margin-top: 8px; text-align: center; font-size: 13.5px;
                    font-weight: 700; color: #f8fafc;
                }
                .clinic-action-cluster {
                    display: flex; gap: 10px; width: 100%; max-width: 640px; margin-top: 8px;
                }
                .clinic-btn {
                    flex: 1; height: 44px; border-radius: 10px; border: none;
                    font-size: 13.5px; font-weight: 800; cursor: pointer; touch-action: manipulation;
                }
                .btn-retry { background: #1e293b; border: 1.5px solid #38bdf8; color: #38bdf8; }
                .btn-next  { background: #0284c7; color: #ffffff; }
                .btn-download { background: #10b981; color: #ffffff; }
                
                /* Scorecard UI */
                .scorecard-panel {
                    width: 100%; max-width: 640px; background: #0f172a; border: 1px solid #334155;
                    border-radius: 14px; padding: 12px 16px; margin-top: 8px; display: none;
                    flex-direction: column; gap: 6px;
                }
                .score-row {
                    display: flex; justify-content: space-between; align-items: center;
                    font-size: 13px; font-weight: 700; padding: 4px 0; border-bottom: 1px solid #1e293b;
                }
            </style>

            <header style="width:100%; max-width:640px; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:14px; font-weight:800; color:#38bdf8;">टॅब ३ • व्हिडिओ तपासणी</span>
                <span id="clinicStatusPill" style="font-size:12px; background:#1e293b; padding:3px 10px; border-radius:12px; color:#4ade80;">कॅमेरा सक्रिय</span>
            </header>

            <div class="clinic-viewport">
                <video id="clinicVideo" class="clinic-video-feed" playsinline autoplay muted></video>
                <canvas id="clinicOverlay" class="clinic-canvas-layer"></canvas>
                <div id="clinicCountdown" class="clinic-countdown-badge">सज्ज व्हा...</div>
            </div>

            <div id="clinicInstructionBanner" class="clinic-banner-bar">
                भिंतीवर १ निशाणा लावा. ऑन-गार्द पोझिशनमध्ये ३ सेकंद स्थिर उभे राहा.
            </div>

            <div id="clinicSoftGateControls" class="clinic-action-cluster" style="display: none;">
                <button class="clinic-btn btn-retry" onclick="window.RivaClinic.retryStance()">🔄 पुन्हा ठीक करा</button>
                <button class="clinic-btn btn-next" onclick="window.RivaClinic.proceedToLunge()">झेप सुरू करा ➔</button>
            </div>

            <!-- Phase 4 Consolidated Scorecard -->
            <div id="clinicScorecard" class="scorecard-panel">
                <div style="text-align:center; font-weight:800; color:#38bdf8; margin-bottom:4px;">🎯 संपूर्ण प्रगती अहवाल</div>
                <div class="score-row"><span>१. पवित्रा आणि तोल (Stance)</span><span id="starStance">⭐⭐⭐</span></div>
                <div class="score-row"><span>२. हाताचा पहारा (Guard)</span><span id="starGuard">⭐⭐⭐</span></div>
                <div class="score-row"><span>३. आक्रमण क्रमवारी (Sequence)</span><span id="starSequence">⭐⭐⭐</span></div>
                <div class="score-row"><span>४. लँडिंग सुरक्षा (Landing)</span><span id="starLanding">⭐⭐⭐</span></div>
                <div class="clinic-action-cluster" style="margin-top: 10px;">
                    <button class="clinic-btn btn-retry" onclick="window.RivaClinic.retryStance()">🔄 पुन्हा सराव करा</button>
                    <button class="clinic-btn btn-download" onclick="window.RivaClinic.downloadReportCard()">💾 फोटो सेव्ह करा</button>
                </div>
            </div>
        `;

        videoElement = document.getElementById('clinicVideo');
        canvasOverlay = document.getElementById('clinicOverlay');
        canvasCtx = canvasOverlay.getContext('2d');

        // Circular 2-frame canvas buffer
        snapshotCanvasA = document.createElement('canvas');
        snapshotCanvasB = document.createElement('canvas');
        snapshotCtxA = snapshotCanvasA.getContext('2d');
        snapshotCtxB = snapshotCanvasB.getContext('2d');
    }

    async function startCamera() {
        const constraints = {
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        };

        try {
            mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        videoElement.srcObject = mediaStream;
        await videoElement.play();

        const vW = videoElement.videoWidth || 640;
        const vH = videoElement.videoHeight || 480;
        canvasOverlay.width = vW;
        canvasOverlay.height = vH;
        snapshotCanvasA.width = vW;
        snapshotCanvasA.height = vH;
        snapshotCanvasB.width = vW;
        snapshotCanvasB.height = vH;
    }

    // -------------------------------------------------------------
    // 4. GEOMETRIC COMPUTATION (SCALE-INVARIANT PIXEL SPACE)
    // -------------------------------------------------------------
    function calculateJointAngle(pA, pB, pC, vW, vH) {
        const ax = pA.x * vW, ay = pA.y * vH;
        const bx = pB.x * vW, by = pB.y * vH;
        const cx = pC.x * vW, cy = pC.y * vH;

        const v1x = ax - bx, v1y = ay - by;
        const v2x = cx - bx, v2y = cy - by;

        const dot = (v1x * v2x) + (v1y * v2y);
        const mag1 = Math.sqrt((v1x * v1x) + (v1y * v1y));
        const mag2 = Math.sqrt((v2x * v2x) + (v2y * v2y));

        if (mag1 * mag2 === 0) return 180;
        let cosine = dot / (mag1 * mag2);
        cosine = Math.max(-1.0, Math.min(1.0, cosine));

        return (Math.acos(cosine) * 180) / Math.PI;
    }

    function calculateDistance(p1, p2, vW, vH) {
        const dx = (p1.x - p2.x) * vW;
        const dy = (p1.y - p2.y) * vH;
        return Math.sqrt((dx * dx) + (dy * dy));
    }

    // -------------------------------------------------------------
    // 5. PHASE 2: STATIC EN GARDE AUDIT & SOFT GATE
    // -------------------------------------------------------------
    function runStanceCountdown() {
        currentPhase = 'STANCE_COUNTDOWN';
        let count = 3;
        const badge = document.getElementById('clinicCountdown');
        document.getElementById('clinicSoftGateControls').style.display = 'none';
        document.getElementById('clinicScorecard').style.display = 'none';
        canvasOverlay.style.display = 'block';
        videoElement.style.display = 'block';

        badge.innerText = `३... स्थिर राहा`;
        speakCoachingCue('तीन');

        countdownTimer = setInterval(() => {
            count--;
            if (count === 2) {
                badge.innerText = `२... ऑन-गार्द`;
                speakCoachingCue('दोन');
            } else if (count === 1) {
                badge.innerText = `१... थांबा!`;
                speakCoachingCue('एक... थांबा!');
            } else if (count <= 0) {
                clearInterval(countdownTimer);
                badge.innerText = `तपासणी सुरू...`;
                auditStaticEnGarde();
            }
        }, 1000);
    }

    function auditStaticEnGarde() {
        currentPhase = 'STANCE_AUDIT';
        const vW = videoElement.videoWidth;
        const vH = videoElement.videoHeight;
        canvasCtx.clearRect(0, 0, vW, vH);

        const now = performance.now();
        const result = poseLandmarker.detectForVideo(videoElement, now);

        if (!result.landmarks || result.landmarks.length === 0) {
            document.getElementById('clinicInstructionBanner').innerText = 'खेळाडू दिसला नाही. पूर्ण शरीर कॅमेऱ्यात दिसेल असे उभे राहा.';
            speakCoachingCue('कॅमेऱ्यासमोर थोडे मागे व्हा.');
            document.getElementById('clinicSoftGateControls').style.display = 'flex';
            return;
        }

        const lm = result.landmarks[0];
        const isRightFacing = lm[28].x > lm[27].x;

        const leadAnkle = isRightFacing ? lm[28] : lm[27];
        const rearAnkle = isRightFacing ? lm[27] : lm[28];
        const leadKnee  = isRightFacing ? lm[26] : lm[25];
        const rearKnee  = isRightFacing ? lm[25] : lm[26];
        const leadHip   = isRightFacing ? lm[24] : lm[23];
        const rearHip   = isRightFacing ? lm[23] : lm[24];
        const leadWrist = isRightFacing ? lm[16] : lm[15];
        const leadElbow = isRightFacing ? lm[14] : lm[13];
        const leadShoulder = isRightFacing ? lm[12] : lm[11];

        const shoulderWidth = calculateDistance(lm[11], lm[12], vW, vH);
        const stanceWidth   = calculateDistance(leadAnkle, rearAnkle, vW, vH);
        const leadKneeAngle = calculateJointAngle(leadHip, leadKnee, leadAnkle, vW, vH);
        const elbowAngle    = calculateJointAngle(leadShoulder, leadElbow, leadWrist, vW, vH);

        const baseRatio = stanceWidth / (shoulderWidth || 1);
        const isBaseValid = baseRatio >= 1.25 && baseRatio <= 2.2;
        const isKneeValid = leadKneeAngle >= 105 && leadKneeAngle <= 145;
        const isGuardValid = elbowAngle >= 80 && elbowAngle <= 135;

        // Draw joint status markers
        drawMarker(leadKnee, vW, vH, isKneeValid);
        drawMarker(leadAnkle, vW, vH, isBaseValid);
        drawMarker(leadElbow, vW, vH, isGuardValid);

        baselineData = {
            isRightFacing,
            shoulderWidth,
            stanceWidth,
            leadAnkleBaselineY: leadAnkle.y * vH,
            rearAnkleBaselineY: rearAnkle.y * vH,
            stanceStars: (isBaseValid && isKneeValid) ? 3 : 1,
            guardStars: isGuardValid ? 3 : 1
        };

        const banner = document.getElementById('clinicInstructionBanner');
        if (!isKneeValid) {
            banner.innerText = '⚠️ गुडघे थोडे अजून वाकवा, तोल मध्यभागी ठेवा!';
            speakCoachingCue('गुडघे थोडे अजून वाकवा, थोडे खाली बसा!');
        } else if (!isBaseValid) {
            banner.innerText = '⚠️ पायांमधील अंतर तपासा (~२.५ पावले अंतर ठेवा).';
            speakCoachingCue('पायांमध्ये योग्य अंतर ठेवा!');
        } else if (!isGuardValid) {
            banner.innerText = '⚠️ हात छातीच्या रेषेत ठेवा, कोपर सैल सोडा!';
            speakCoachingCue('हात छातीच्या रेषेत ठेवा!');
        } else {
            banner.innerText = '✅ उत्तम स्थिती! आता झेप घेण्यासाठी तयार व्हा.';
            speakCoachingCue('छान पोझिशन! आता लंजसाठी सज्ज व्हा.');
        }

        document.getElementById('clinicCountdown').innerText = 'स्थिती नोंदवली!';
        document.getElementById('clinicSoftGateControls').style.display = 'flex';
    }

    function drawMarker(landmark, vW, vH, isValid) {
        canvasCtx.beginPath();
        canvasCtx.arc(landmark.x * vW, landmark.y * vH, 12, 0, 2 * Math.PI);
        canvasCtx.lineWidth = 3.5;
        canvasCtx.strokeStyle = isValid ? '#22c55e' : '#ef4444';
        canvasCtx.fillStyle = isValid ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.4)';
        canvasCtx.fill();
        canvasCtx.stroke();
    }

    // -------------------------------------------------------------
    // 6. PHASE 3: DYNAMIC LUNGE TRACKER (15 FPS COORDINATE BUFFER)
    // -------------------------------------------------------------
    function proceedToLunge() {
        currentPhase = 'LUNGE_TRACKING';
        coordinateBuffer = [];
        document.getElementById('clinicSoftGateControls').style.display = 'none';
        canvasCtx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

        const badge = document.getElementById('clinicCountdown');
        const banner = document.getElementById('clinicInstructionBanner');
        badge.innerText = '⚡ लंज ट्रॅकर सक्रिय';
        banner.innerText = 'निशाण्यावर लक्ष ठेवून रॉकेट लंज मारा!';
        speakCoachingCue('आता रॉकेट लंज मारा!');

        lastFrameTime = performance.now();
        trackLungeLoop();
    }

    function trackLungeLoop() {
        if (!isRunning || currentPhase !== 'LUNGE_TRACKING') return;

        const now = performance.now();
        // 15 FPS throttle window (~66 ms)
        if (now - lastFrameTime >= 66) {
            lastFrameTime = now;
            processLungeFrame(now);
        }

        animFrameId = requestAnimationFrame(trackLungeLoop);
    }

    function processLungeFrame(timestamp) {
        const vW = videoElement.videoWidth;
        const vH = videoElement.videoHeight;

        // Maintain retrospective 2-frame circular snapshot buffer
        if (activeSnapshotSlot === 0) {
            snapshotCtxA.drawImage(videoElement, 0, 0, vW, vH);
            activeSnapshotSlot = 1;
        } else {
            snapshotCtxB.drawImage(videoElement, 0, 0, vW, vH);
            activeSnapshotSlot = 0;
        }

        const result = poseLandmarker.detectForVideo(videoElement, timestamp);
        if (!result.landmarks || result.landmarks.length === 0) return;

        const lm = result.landmarks[0];
        coordinateBuffer.push({ t: timestamp, lm });
        if (coordinateBuffer.length > MAX_BUFFER_FRAMES) coordinateBuffer.shift();

        // Mathematical Peak Extension Spotter
        checkLungeExtensionPeak(vW, vH);
    }

    function checkLungeExtensionPeak(vW, vH) {
        if (coordinateBuffer.length < 5) return;

        const dir = baselineData.isRightFacing ? 1 : -1;
        const curr = coordinateBuffer[coordinateBuffer.length - 1];
        const prev = coordinateBuffer[coordinateBuffer.length - 2];
        const prev2 = coordinateBuffer[coordinateBuffer.length - 3];

        const currWristX = (baselineData.isRightFacing ? curr.lm[16].x : curr.lm[15].x) * vW;
        const prevWristX = (baselineData.isRightFacing ? prev.lm[16].x : prev.lm[15].x) * vW;
        const prev2WristX = (baselineData.isRightFacing ? prev2.lm[16].x : prev2.lm[15].x) * vW;

        // 3-frame moving average to smooth velocity
        const smoothedPrevX = (prevWristX + prev2WristX) / 2;
        const velocityX = (currWristX - smoothedPrevX) * dir;

        // Extension expansion check (wrist to rear ankle > 160% of baseline stance)
        const rearAnkle = baselineData.isRightFacing ? curr.lm[27] : curr.lm[28];
        const extensionSpan = Math.abs(currWristX - (rearAnkle.x * vW));

        // Trigger condition: Extension reached and forward velocity drops to zero
        if (extensionSpan > baselineData.stanceWidth * 1.55 && velocityX <= 0.8) {
            cancelAnimationFrame(animFrameId);
            currentPhase = 'REPORT';
            evaluateAndGenerateReport(vW, vH);
        }
    }

    // -------------------------------------------------------------
    // 7. PHASE 4: BIOMECHANICAL AUDIT & LOCAL SCORECARD
    // -------------------------------------------------------------
    function evaluateAndGenerateReport(vW, vH) {
        // Freeze peak snapshot from the slot captured 66ms prior
        const peakCanvas = (activeSnapshotSlot === 1) ? snapshotCanvasA : snapshotCanvasB;
        canvasOverlay.width = vW;
        canvasOverlay.height = vH;
        canvasCtx.drawImage(peakCanvas, 0, 0, vW, vH);

        const peakFrame = coordinateBuffer[coordinateBuffer.length - 2] || coordinateBuffer[coordinateBuffer.length - 1];
        const lm = peakFrame.lm;
        const dir = baselineData.isRightFacing ? 1 : -1;

        const leadWrist = baselineData.isRightFacing ? lm[16] : lm[15];
        const leadAnkle = baselineData.isRightFacing ? lm[28] : lm[27];
        const leadKnee  = baselineData.isRightFacing ? lm[26] : lm[25];
        const rearAnkle = baselineData.isRightFacing ? lm[27] : lm[28];
        const shoulder  = baselineData.isRightFacing ? lm[12] : lm[11];
        const hip       = baselineData.isRightFacing ? lm[24] : lm[23];

        // Biomechanical Rule Audits
        // 1. Kinetic Sequence: Wrist launch timing vs Ankle launch timing
        let sequenceStars = 3;
        if (coordinateBuffer.length >= 8) {
            const startFrame = coordinateBuffer[0];
            const startWristX = (baselineData.isRightFacing ? startFrame.lm[16].x : startFrame.lm[15].x) * vW;
            const startAnkleX = (baselineData.isRightFacing ? startFrame.lm[28].x : startFrame.lm[27].x) * vW;
            
            const midFrame = coordinateBuffer[Math.floor(coordinateBuffer.length / 2)];
            const midWristDelta = Math.abs((baselineData.isRightFacing ? midFrame.lm[16].x : midFrame.lm[15].x) * vW - startWristX);
            const midAnkleDelta = Math.abs((baselineData.isRightFacing ? midFrame.lm[28].x : midFrame.lm[27].x) * vW - startAnkleX);

            if (midAnkleDelta > midWristDelta) sequenceStars = 1;
        }

        // 2. Landing Safety: Shin Stack & Knee Shear (Knee past ankle lace)
        const kneeX = leadKnee.x * vW;
        const ankleX = leadAnkle.x * vW;
        const anteriorShear = (kneeX - ankleX) * dir;
        const isKneeSheared = anteriorShear > (vW * 0.04);

        // 3. Rear Foot Anchor (Vertical Delta from baseline floor)
        const rearAnkleY = rearAnkle.y * vH;
        const rearFootLifted = (baselineData.rearAnkleBaselineY - rearAnkleY) > (vH * 0.07);

        // 4. Torso Pitch Angle relative to vertical
        const torsoAngle = calculateJointAngle({ x: hip.x, y: 0 }, hip, shoulder, vW, vH);
        const isTorsoOverleaning = torsoAngle > 22;

        const landingStars = (!isKneeSheared && !rearFootLifted && !isTorsoOverleaning) ? 3 : 1;

        // Render Clean Green Vectors
        drawSkeletonLine(leadShoulder, leadElbow, vW, vH);
        drawSkeletonLine(leadElbow, leadWrist, vW, vH);
        drawSkeletonLine(leadHip, leadKnee, vW, vH);
        drawSkeletonLine(leadKnee, leadAnkle, vW, vH);

        // Prioritized Worst-Fault Red Ring
        let primaryFaultCue = 'उत्कृष्ट रॉकेट झेप! तोल आणि वेग अचूक.';
        let faultJoint = null;

        if (sequenceStars === 1) {
            primaryFaultCue = 'आधी हात फेका, मग पुढचा पाय टाका!';
            faultJoint = leadWrist;
        } else if (isKneeSheared) {
            primaryFaultCue = 'पुढच्या टाचेवर वजन टाका, गुडघा सावरून ठेवा!';
            faultJoint = leadKnee;
        } else if (rearFootLifted) {
            primaryFaultCue = 'मागचा पाय सपाट दाबा!';
            faultJoint = rearAnkle;
        } else if (isTorsoOverleaning) {
            primaryFaultCue = 'छाती सरळ ठेवा, पुढच्या पायावर जास्त झुकू नका!';
            faultJoint = shoulder;
        }

        if (faultJoint) {
            canvasCtx.beginPath();
            canvasCtx.arc(faultJoint.x * vW, faultJoint.y * vH, 18, 0, 2 * Math.PI);
            canvasCtx.lineWidth = 4;
            canvasCtx.strokeStyle = '#ef4444';
            canvasCtx.stroke();
        }

        // Output Delivery (Voice + Banner + Scorecard)
        const banner = document.getElementById('clinicInstructionBanner');
        banner.innerText = primaryFaultCue;
        speakCoachingCue(primaryFaultCue);

        document.getElementById('clinicCountdown').innerText = 'अहवाल तयार!';
        document.getElementById('starStance').innerText = '⭐'.repeat(baselineData.stanceStars);
        document.getElementById('starGuard').innerText = '⭐'.repeat(baselineData.guardStars);
        document.getElementById('starSequence').innerText = '⭐'.repeat(sequenceStars);
        document.getElementById('starLanding').innerText = '⭐'.repeat(landingStars);

        document.getElementById('clinicScorecard').style.display = 'flex';
        videoElement.style.display = 'none'; // Save GPU cycles
    }

    function drawSkeletonLine(p1, p2, vW, vH) {
        if (!p1 || !p2) return;
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x * vW, p1.y * vH);
        canvasCtx.lineTo(p2.x * vW, p2.y * vH);
        canvasCtx.lineWidth = 3;
        canvasCtx.strokeStyle = '#22c55e';
        canvasCtx.stroke();
    }

    // -------------------------------------------------------------
    // 8. PUBLIC MODULE INTERFACE
    // -------------------------------------------------------------
    window.RivaClinic = {
        init: async () => {
            isRunning = true;
            primeSpeechAudio();
            buildClinicDOM();

            try {
                await initMediaPipePose();
                await startCamera();
                runStanceCountdown();
            } catch (e) {
                const b = document.getElementById('clinicInstructionBanner');
                if (b) b.innerText = 'कॅमेरा किंवा AI मॉडेल सुरू करताना त्रुटी आली.';
            }
        },

        stop: () => {
            isRunning = false;
            clearInterval(countdownTimer);
            cancelAnimationFrame(animFrameId);

            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop());
                mediaStream = null;
            }
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
            if (canvasCtx && canvasOverlay) {
                canvasCtx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
            }
        },

        retryStance: () => {
            runStanceCountdown();
        },

        proceedToLunge: () => {
            proceedToLunge();
        },

        downloadReportCard: () => {
            if (!canvasOverlay) return;
            const link = document.createElement('a');
            link.download = 'riva_lunge_report.jpg';
            link.href = canvasOverlay.toDataURL('image/jpeg', 0.9);
            link.click();
        }
    };
})();
