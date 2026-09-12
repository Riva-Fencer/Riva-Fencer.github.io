/**
 * Riva Fencer - Tab 3: Kinetic Video Clinic (तपासणी)
 * Release #3: Resilient Dynamic Peak Spotter & Live Tracking HUD
 * 100% Client-Side, Child-Calibrated Multipliers, Auto-Resolve Fallback.
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

    // Phase 3 Dynamic State & Buffers
    const MAX_BUFFER_FRAMES = 75; // 5 seconds at 15 FPS
    let coordinateBuffer = [];
    let lastFrameTime = 0;
    let animFrameId = null;
    let lungePhaseStartTime = 0;

    // Peak tracking
    let maxExtensionRecorded = 0;
    let peakFrameData = null;

    // Retrospective 2-Frame Canvas Buffer
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
    // 3. DOM & CAMERA
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
                ऑन-गार्द पोझिशनमध्ये ३ सेकंद स्थिर उभे राहा.
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
    // 4. KINEMATIC GEOMETRY
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
    // 5. PHASE 2: STATIC EN GARDE
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

        if (!result.landmarks || result.landmarks.length === 0) {
            document.getElementById('clinicInstructionBanner').innerText = 'कॅमेऱ्यासमोर थोडे मागे व्हा, पूर्ण शरीर दिसू द्या.';
            speakCoachingCue('कॅमेऱ्यासमोर थोडे मागे व्हा.');
            document.getElementById('clinicSoftGateControls').style.display = 'flex';
            return;
        }

        const lm = result.landmarks[0];
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
        const isBaseValid = baseRatio >= 1.15 && baseRatio <= 2.3;
        const isKneeValid = leadKneeAngle >= 100 && leadKneeAngle <= 150;
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
            banner.innerText = '✅ उत्तम स्थिती! आता झेप घेण्यासाठी तयार व्हा.';
            speakCoachingCue('छान पोझिशन! आता लंज मारा.');
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
    // 6. PHASE 3: DYNAMIC LUNGE TRACKER
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
        banner.innerText = 'पुढे पाऊल टाकून लंज मारा! कॅमेरा आपोआप कॅप्चर करेल.';
        speakCoachingCue('रॉकेट लंज मारा!');

        lastFrameTime = performance.now();
        trackLungeLoop();
    }

    function trackLungeLoop() {
        if (!isRunning || currentPhase !== 'LUNGE_TRACKING') return;

        const now = performance.now();

        // 15 FPS throttle (~66 ms)
        if (now - lastFrameTime >= 66) {
            lastFrameTime = now;
            processLungeFrame(now);
        }

        // 5-Second Fallback Safety: Auto-captures the highest extension frame so it never hangs
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

        // Circular 2-frame snapshot buffer
        const currentSlotCtx = (activeSnapshotSlot === 0) ? snapshotCtxA : snapshotCtxB;
        currentSlotCtx.drawImage(videoElement, 0, 0, vW, vH);
        activeSnapshotSlot = (activeSnapshotSlot === 0) ? 1 : 0;

        const result = poseLandmarker.detectForVideo(videoElement, timestamp);
        if (!result.landmarks || result.landmarks.length === 0) return;

        const lm = result.landmarks[0];
        coordinateBuffer.push({ t: timestamp, lm });
        if (coordinateBuffer.length > MAX_BUFFER_FRAMES) coordinateBuffer.shift();

        // Live HUD: Draw real-time dots on joints so parent knows tracking is active
        canvasCtx.clearRect(0, 0, vW, vH);
        const leadWrist = baselineData.isRightFacing ? lm[16] : lm[15];
        const leadKnee  = baselineData.isRightFacing ? lm[26] : lm[25];
        const leadAnkle = baselineData.isRightFacing ? lm[28] : lm[27];
        const rearAnkle = baselineData.isRightFacing ? lm[27] : lm[28];

        [leadWrist, leadKnee, leadAnkle, rearAnkle].forEach(pt => {
            canvasCtx.beginPath();
            canvasCtx.arc(pt.x * vW, pt.y * vH, 6, 0, 2 * Math.PI);
            canvasCtx.fillStyle = '#38bdf8';
            canvasCtx.fill();
        });

        // Evaluate extension reach
        const currWristX = leadWrist.x * vW;
        const rearAnkleX = rearAnkle.x * vW;
        const currentExtensionSpan = Math.abs(currWristX - rearAnkleX);

        if (currentExtensionSpan > maxExtensionRecorded) {
            maxExtensionRecorded = currentExtensionSpan;
            peakFrameData = {
                lm,
                slotIndex: activeSnapshotSlot === 1 ? 0 : 1 // Save the canvas slot containing this peak
            };
        }

        // Peak Lock Trigger:
        // 1. Expansion crosses 120% of stance width (calibrated for 6-year-old child)
        // 2. Athlete hits apex and begins recoil (span drops 3% below maximum reached)
        const baselineGate = baselineData.stanceWidth * 1.20;
        if (maxExtensionRecorded > baselineGate && currentExtensionSpan < (maxExtensionRecorded * 0.97)) {
            cancelAnimationFrame(animFrameId);
            currentPhase = 'REPORT';
            evaluateAndGenerateReport(vW, vH);
        }
    }

    // -------------------------------------------------------------
    // 7. PHASE 4: REPORT CARD & DIAGNOSTIC AUDIT
    // -------------------------------------------------------------
    function evaluateAndGenerateReport(vW, vH) {
        // Freeze canvas using the snapshot slot corresponding to the peak frame
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

        // 1. Kinetic Sequence Audit
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

        // 2. Landing Safety (Shin Stack & Anterior Knee Shear)
        const kneeX = leadKnee.x * vW;
        const ankleX = leadAnkle.x * vW;
        const anteriorShear = (kneeX - ankleX) * dir;
        const isKneeSheared = anteriorShear > (vW * 0.05);

        // 3. Rear Anchor Lift
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

        // Prioritized Fault Flagging (Red Ring)
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

        // Update Scorecard UI
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
