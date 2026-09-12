/**
 * Riva Fencer - Tab 3: Kinetic Video Clinic (तपासणी)
 * Release #4: Foreground Multi-Person Filter & Robust Child Tracker
 * Automatically selects the primary athlete in foreground, ignoring background bystanders.
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

    // Phase 3 Dynamic State
    const MAX_BUFFER_FRAMES = 75;
    let coordinateBuffer = [];
    let lastFrameTime = 0;
    let animFrameId = null;
    let lungePhaseStartTime = 0;

    let maxExtensionRecorded = 0;
    let peakFrameData = null;

    // Snapshot Double-Buffer
    let snapshotCanvasA = null;
    let snapshotCanvasB = null;
    let snapshotCtxA = null;
    let snapshotCtxB = null;
    let activeSnapshotSlot = 0;

    // -------------------------------------------------------------
    // 1. AUDIO & SPEECH
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
    // 2. MEDIAPIPE INITIALIZER (MULTI-PERSON AWARE)
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
            numPoses: 2 // Detect up to 2 to filter out background parents
        });

        return poseLandmarker;
    }

    // -------------------------------------------------------------
    // 3. TARGET FILTER: PICK CLOSEST FOREGROUND ATHLETE
    // -------------------------------------------------------------
    function selectPrimaryAthleteLandmarks(landmarksList, vW, vH) {
        if (!landmarksList || landmarksList.length === 0) return null;
        if (landmarksList.length === 1) return landmarksList[0];

        // If multiple persons exist, calculate bounding area to pick the foreground athlete
        let largestArea = 0;
        let primaryPose = landmarksList[0];

        landmarksList.forEach(lm => {
            let minX = 1, maxX = 0, minY = 1, maxY = 0;
            lm.forEach(pt => {
                if (pt.x < minX) minX = pt.x;
                if (pt.x > maxX) maxX = pt.x;
                if (pt.y < minY) minY = pt.y;
                if (pt.y > maxY) maxY = pt.y;
            });

            const area = (maxX - minX) * (maxY - minY);
            // Bias toward person positioned lower/closer in viewport
            const groundWeight = maxY;
            const score = area * groundWeight;

            if (score > largestArea) {
                largestArea = score;
                primaryPose = lm;
            }
        });

        return primaryPose;
    }

    // -------------------------------------------------------------
    // 4. VIEWPORT BUILD
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
                    background: rgba(15, 23, 42, 0.90); border: 1.5px solid #38bdf8;
                    padding: 5px 16px; border-radius: 999px; font-size: 15px;
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
                खेळाडूने पूर्ण शरीरासह ऑन-गार्द पोझिशनमध्ये ३ सेकंद स्थिर उभे राहावे.
            </div>

            <div id="clinicSoftGateControls" class="clinic-action-cluster" style="display: none;">
                <button class="clinic-btn btn-retry" onclick="window.RivaClinic.retryStance()">🔄 पुन्हा ठीक करा</button>
                <button class="clinic-btn btn-next" onclick="window.RivaClinic.proceedToLunge()">झेप सुरू करा ➔</button>
            </div>

            <!-- Scorecard Panel -->
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
    // 5. VECTOR GEOMETRY
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
    // 6. PHASE 2: STATIC STANCE AUDIT
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
                badge.innerText = `तपासत आहे...`;
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
        const lm = selectPrimaryAthleteLandmarks(result.landmarks, vW, vH);

        if (!lm) {
            document.getElementById('clinicInstructionBanner').innerText = 'खेळाडू कॅमेऱ्यात स्पष्ट दिसला नाही. कृपया फ्रेममध्ये फक्त १ खेळाडू ठेवा.';
            speakCoachingCue('फ्रेममध्ये पूर्ण उभे राहा.');
            document.getElementById('clinicSoftGateControls').style.display = 'flex';
            return;
        }

        const isRightFacing = lm[28].x > lm[27].x;

        const leadAnkle = isRightFacing ? lm[28] : lm[27];
        const rearAnkle = isRightFacing ? lm[27] : lm[28];
        const leadKnee  = isRightFacing ? lm[26] : lm[25];
        const leadHip   = isRightFacing ? lm[24] : lm[23];
        const leadWrist = isRightFacing ? lm[16] : lm[15];
        const leadElbow = isRightFacing ? lm[14] : lm[13];
        const leadShoulder = isRightFacing ? lm[12] : lm[11];

        const shoulderWidth = calculateDistance(lm[11], lm[12], vW, vH);
        const stanceWidth   = calculateDistance(leadAnkle, rearAnkle, vW, vH);
        const leadKneeAngle = calculateJointAngle(leadHip, leadKnee, leadAnkle, vW, vH);
        const elbowAngle    = calculateJointAngle(leadShoulder, leadElbow, leadWrist, vW, vH);

        const baseRatio = stanceWidth / (shoulderWidth || 1);
        const isBaseValid = baseRatio >= 1.10 && baseRatio <= 2.4;
        const isKneeValid = leadKneeAngle >= 100 && leadKneeAngle <= 155;
        const isGuardValid = elbowAngle >= 75 && elbowAngle <= 145;

        drawJointPoint(leadKnee, vW, vH, isKneeValid);
        drawJointPoint(leadAnkle, vW, vH, isBaseValid);
        drawJointPoint(leadElbow, vW, vH, isGuardValid);

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
            speakCoachingCue('गुडघे थोडे वाकवा!');
        } else if (!isBaseValid) {
            banner.innerText = '⚠️ पायांमधील अंतर तपासा (~२.५ पावले अंतर ठेवा).';
            speakCoachingCue('पायांमध्ये योग्य अंतर ठेवा!');
        } else if (!isGuardValid) {
            banner.innerText = '⚠️ हात छातीच्या रेषेत ठेवा, कोपर सैल सोडा!';
            speakCoachingCue('हात छातीच्या रेषेत ठेवा!');
        } else {
            banner.innerText = '✅ उत्तम मूलभूत स्थिती! आता रॉकेट लंज मारा.';
            speakCoachingCue('छान स्थिती! आता लंज मारा.');
        }

        document.getElementById('clinicCountdown').innerText = 'स्थिती नोंदवली!';
        document.getElementById('clinicSoftGateControls').style.display = 'flex';
    }

    function drawJointPoint(lm, vW, vH, isValid) {
        canvasCtx.beginPath();
        canvasCtx.arc(lm.x * vW, lm.y * vH, 11, 0, 2 * Math.PI);
        canvasCtx.lineWidth = 3;
        canvasCtx.strokeStyle = isValid ? '#22c55e' : '#ef4444';
        canvasCtx.fillStyle = isValid ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.4)';
        canvasCtx.fill();
        canvasCtx.stroke();
    }

    // -------------------------------------------------------------
    // 7. PHASE 3: DYNAMIC LUNGE TRACKER
    // -------------------------------------------------------------
    function proceedToLunge() {
        currentPhase = 'LUNGE_TRACKING';
        coordinateBuffer = [];
        maxExtensionRecorded = 0;
        peakFrameData = null;
        lungePhaseStartTime = performance.now();

        document.getElementById('clinicSoftGateControls').style.display = 'none';
        canvasCtx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

        const badge = document.getElementById('clinicCountdown');
        const banner = document.getElementById('clinicInstructionBanner');
        badge.innerText = '⚡ रॉकेट लंज मारा!';
        banner.innerText = 'पुढे झेप घ्या! कॅमेरा आपोआप सर्वोच्च बिंदू कॅप्चर करेल.';
        speakCoachingCue('रॉकेट लंज मारा!');

        lastFrameTime = performance.now();
        trackLungeLoop();
    }

    function trackLungeLoop() {
        if (!isRunning || currentPhase !== 'LUNGE_TRACKING') return;

        const now = performance.now();

        if (now - lastFrameTime >= 66) {
            lastFrameTime = now;
            processLungeFrame(now);
        }

        // 5-second automatic fallback lock
        if (now - lungePhaseStartTime > 5000) {
            if (coordinateBuffer.length > 0) {
                currentPhase = 'REPORT';
                evaluateAndGenerateReport(videoElement.videoWidth, videoElement.videoHeight);
                return;
            }
        }

        animFrameId = requestAnimationFrame(trackLungeLoop);
    }

    function processLungeFrame(timestamp) {
        const vW = videoElement.videoWidth;
        const vH = videoElement.videoHeight;

        const currentSlotCtx = (activeSnapshotSlot === 0) ? snapshotCtxA : snapshotCtxB;
        currentSlotCtx.drawImage(videoElement, 0, 0, vW, vH);
        activeSnapshotSlot = (activeSnapshotSlot === 0) ? 1 : 0;

        const result = poseLandmarker.detectForVideo(videoElement, timestamp);
        const lm = selectPrimaryAthleteLandmarks(result.landmarks, vW, vH);
        if (!lm) return;

        coordinateBuffer.push({ t: timestamp, lm });
        if (coordinateBuffer.length > MAX_BUFFER_FRAMES) coordinateBuffer.shift();

        // Real-time tracking HUD
        canvasCtx.clearRect(0, 0, vW, vH);
        const leadWrist = baselineData.isRightFacing ? lm[16] : lm[15];
        const leadKnee  = baselineData.isRightFacing ? lm[26] : lm[25];
        const leadAnkle = baselineData.isRightFacing ? lm[28] : lm[27];
        const rearAnkle = baselineData.isRightFacing ? lm[27] : lm[28];

        [leadWrist, leadKnee, leadAnkle, rearAnkle].forEach(pt => {
            canvasCtx.beginPath();
            canvasCtx.arc(pt.x * vW, pt.y * vH, 7, 0, 2 * Math.PI);
            canvasCtx.fillStyle = '#38bdf8';
            canvasCtx.fill();
        });

        // Track peak extension
        const currWristX = leadWrist.x * vW;
        const rearAnkleX = rearAnkle.x * vW;
        const currentExtensionSpan = Math.abs(currWristX - rearAnkleX);

        if (currentExtensionSpan > maxExtensionRecorded) {
            maxExtensionRecorded = currentExtensionSpan;
            peakFrameData = {
                lm,
                slotIndex: activeSnapshotSlot === 1 ? 0 : 1
            };
        }

        // Trigger condition: Extension crosses baseline and recoils by 3%
        const baselineGate = baselineData.stanceWidth * 1.15;
        if (maxExtensionRecorded > baselineGate && currentExtensionSpan < (maxExtensionRecorded * 0.97)) {
            cancelAnimationFrame(animFrameId);
            currentPhase = 'REPORT';
            evaluateAndGenerateReport(vW, vH);
        }
    }

    // -------------------------------------------------------------
    // 8. PHASE 4: SCORECARD & FEEDBACK
    // -------------------------------------------------------------
    function evaluateAndGenerateReport(vW, vH) {
        const chosenCanvas = (peakFrameData && peakFrameData.slotIndex === 0) ? snapshotCanvasA : snapshotCanvasB;
        canvasOverlay.width = vW;
        canvasOverlay.height = vH;
        canvasCtx.drawImage(chosenCanvas, 0, 0, vW, vH);

        const lm = (peakFrameData && peakFrameData.lm) ? peakFrameData.lm : coordinateBuffer[coordinateBuffer.length - 1].lm;
        const dir = baselineData.isRightFacing ? 1 : -1;

        const leadWrist = baselineData.isRightFacing ? lm[16] : lm[15];
        const leadAnkle = baselineData.isRightFacing ? lm[28] : lm[27];
        const leadKnee  = baselineData.isRightFacing ? lm[26] : lm[25];
        const rearAnkle = baselineData.isRightFacing ? lm[27] : lm[28];
        const shoulder  = baselineData.isRightFacing ? lm[12] : lm[11];
        const elbow     = baselineData.isRightFacing ? lm[14] : lm[13];
        const hip       = baselineData.isRightFacing ? lm[24] : lm[23];

        // 1. Kinetic Sequence
        let sequenceStars = 3;
        if (coordinateBuffer.length >= 6) {
            const startFrame = coordinateBuffer[0];
            const startWristX = (baselineData.isRightFacing ? startFrame.lm[16].x : startFrame.lm[15].x) * vW;
            const startAnkleX = (baselineData.isRightFacing ? startFrame.lm[28].x : startFrame.lm[27].x) * vW;

            const midIndex = Math.floor(coordinateBuffer.length / 2);
            const midFrame = coordinateBuffer[midIndex];
            const midWristDelta = Math.abs((baselineData.isRightFacing ? midFrame.lm[16].x : midFrame.lm[15].x) * vW - startWristX);
            const midAnkleDelta = Math.abs((baselineData.isRightFacing ? midFrame.lm[28].x : midFrame.lm[27].x) * vW - startAnkleX);

            if (midAnkleDelta > midWristDelta) sequenceStars = 1;
        }

        // 2. Knee Over Ankle Shear
        const kneeX = leadKnee.x * vW;
        const ankleX = leadAnkle.x * vW;
        const anteriorShear = (kneeX - ankleX) * dir;
        const isKneeSheared = anteriorShear > (vW * 0.05);

        // 3. Rear Foot Lift
        const rearAnkleY = rearAnkle.y * vH;
        const rearFootLifted = (baselineData.rearAnkleBaselineY - rearAnkleY) > (vH * 0.07);

        // 4. Torso Lean
        const torsoAngle = calculateJointAngle({ x: hip.x, y: 0 }, hip, shoulder, vW, vH);
        const isTorsoOverleaning = torsoAngle > 22;

        const landingStars = (!isKneeSheared && !rearFootLifted && !isTorsoOverleaning) ? 3 : 1;

        // Draw Skeletal Overlay
        drawVectorLine(shoulder, elbow, vW, vH);
        drawVectorLine(elbow, leadWrist, vW, vH);
        drawVectorLine(hip, leadKnee, vW, vH);
        drawVectorLine(leadKnee, leadAnkle, vW, vH);

        // Prioritized Fault Highlight
        let primaryCue = 'उत्कृष्ट रॉकेट झेप! तोल आणि वेग अचूक.';
        let faultPoint = null;

        if (sequenceStars === 1) {
            primaryCue = 'आधी हात फेका, मग पुढचा पाय टाका!';
            faultPoint = leadWrist;
        } else if (isKneeSheared) {
            primaryCue = 'पुढच्या टाचेवर वजन टाका, गुडघा सावरून ठेवा!';
            faultPoint = leadKnee;
        } else if (rearFootLifted) {
            primaryCue = 'मागचा पाय सपाट दाबा!';
            faultPoint = rearAnkle;
        } else if (isTorsoOverleaning) {
            primaryCue = 'छाती सरळ ठेवा, पुढच्या पायावर जास्त झुकू नका!';
            faultPoint = shoulder;
        }

        if (faultPoint) {
            canvasCtx.beginPath();
            canvasCtx.arc(faultPoint.x * vW, faultPoint.y * vH, 18, 0, 2 * Math.PI);
            canvasCtx.lineWidth = 4;
            canvasCtx.strokeStyle = '#ef4444';
            canvasCtx.stroke();
        }

        // Render UI
        const banner = document.getElementById('clinicInstructionBanner');
        banner.innerText = primaryCue;
        speakCoachingCue(primaryCue);

        document.getElementById('clinicCountdown').innerText = 'अहवाल तयार!';
        document.getElementById('starStance').innerText = '⭐'.repeat(baselineData.stanceStars);
        document.getElementById('starGuard').innerText = '⭐'.repeat(baselineData.guardStars);
        document.getElementById('starSequence').innerText = '⭐'.repeat(sequenceStars);
        document.getElementById('starLanding').innerText = '⭐'.repeat(landingStars);

        document.getElementById('clinicScorecard').style.display = 'flex';
        videoElement.style.display = 'none';
    }

    function drawVectorLine(p1, p2, vW, vH) {
        if (!p1 || !p2) return;
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x * vW, p1.y * vH);
        canvasCtx.lineTo(p2.x * vW, p2.y * vH);
        canvasCtx.lineWidth = 3.5;
        canvasCtx.strokeStyle = '#22c55e';
        canvasCtx.stroke();
    }

    // -------------------------------------------------------------
    // 9. PUBLIC API
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
                if (b) b.innerText = 'कॅमेरा किंवा मॉडेल सुरू करताना अडचण आली.';
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
