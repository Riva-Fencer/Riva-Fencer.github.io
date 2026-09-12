/**
 * Riva Fencer - Tab 3: Kinetic Video Clinic (तपासणी)
 * Release #1: Phase 1 Setup & Phase 2 Static En Garde Diagnostic
 * 100% Client-Side, Zero Image Memory Leaks, Relative Biomechanical Vectors.
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
    let stanceAuditResult = null;

    // -------------------------------------------------------------
    // 1. HARDWARE LIFECYCLE & AUDIO PRIMING
    // -------------------------------------------------------------
    function primeSpeechAudio() {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const primeUtterance = new SpeechSynthesisUtterance('');
            window.speechSynthesis.speak(primeUtterance);
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
        utterance.rate = 0.88;
        window.speechSynthesis.speak(utterance);
    }

    // -------------------------------------------------------------
    // 2. OFFLINE MEDIAPIPE INITIALIZER (IMAGE MODE)
    // -------------------------------------------------------------
    async function initMediaPipePose() {
        if (poseLandmarker) return poseLandmarker;

        // Dynamically import Tasks-Vision ES module
        const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
        const { FilesetResolver, PoseLandmarker } = vision;

        // Resolve WASM from the local /models/ directory cached by sw.js
        const fileset = await FilesetResolver.forVisionTasks('./models');

        poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: {
                modelAssetPath: './models/pose_landmarker_lite.task',
                delegate: 'GPU'
            },
            runningMode: 'IMAGE',
            numPoses: 1
        });

        return poseLandmarker;
    }

    // -------------------------------------------------------------
    // 3. VIEWPORT MOUNTING & CAMERA PIPELINE
    // -------------------------------------------------------------
    function buildClinicDOM() {
        container = document.getElementById('clinicStageContainer') || document.getElementById('sparrerPlaceholderView');
        if (!container) return;

        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'space-between';
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
                .clinic-video-feed {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .clinic-canvas-layer {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                }
                .clinic-countdown-badge {
                    position: absolute;
                    top: 14px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(15, 23, 42, 0.88);
                    border: 1.5px solid #38bdf8;
                    padding: 6px 18px;
                    border-radius: 999px;
                    font-size: 18px;
                    font-weight: 800;
                    color: #facc15;
                    backdrop-filter: blur(6px);
                }
                .clinic-banner-bar {
                    width: 100%;
                    max-width: 640px;
                    background: #0f172a;
                    border: 1px solid #1e293b;
                    border-radius: 12px;
                    padding: 8px 14px;
                    margin-top: 8px;
                    text-align: center;
                    font-size: 13.5px;
                    font-weight: 700;
                    color: #f8fafc;
                }
                .clinic-action-cluster {
                    display: flex;
                    gap: 10px;
                    width: 100%;
                    max-width: 640px;
                    margin-top: 8px;
                }
                .clinic-btn {
                    flex: 1;
                    height: 44px;
                    border-radius: 10px;
                    border: none;
                    font-size: 14px;
                    font-weight: 800;
                    cursor: pointer;
                    touch-action: manipulation;
                }
                .btn-retry { background: #1e293b; border: 1.5px solid #38bdf8; color: #38bdf8; }
                .btn-next  { background: #0284c7; color: #ffffff; }
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
                कॅमेऱ्यासमोर एन-गार्द पोझिशनमध्ये ३ सेकंद स्थिर उभे राहा.
            </div>

            <div id="clinicSoftGateControls" class="clinic-action-cluster" style="display: none;">
                <button class="clinic-btn btn-retry" onclick="window.RivaClinic.retryStance()">🔄 पुन्हा ठीक करा</button>
                <button class="clinic-btn btn-next" onclick="window.RivaClinic.proceedToLunge()">पुढे जा ➔</button>
            </div>
        `;

        videoElement = document.getElementById('clinicVideo');
        canvasOverlay = document.getElementById('clinicOverlay');
        canvasCtx = canvasOverlay.getContext('2d');
    }

    async function startCamera() {
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        try {
            mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            videoElement.srcObject = mediaStream;
            await videoElement.play();

            canvasOverlay.width = videoElement.videoWidth || 640;
            canvasOverlay.height = videoElement.videoHeight || 480;
        } catch (err) {
            // Fallback for laptops/front-camera testing
            mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            videoElement.srcObject = mediaStream;
            await videoElement.play();

            canvasOverlay.width = videoElement.videoWidth || 640;
            canvasOverlay.height = videoElement.videoHeight || 480;
        }
    }

    // -------------------------------------------------------------
    // 4. BIOMECHANICAL MATH (ANISOTROPIC SCALED EUCLIDEAN VECTORS)
    // -------------------------------------------------------------
    function calculateJointAngle(pA, pB, pC, vW, vH) {
        // Scale normalized landmarks to true pixel coordinates to eliminate aspect distortion
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
    // 5. PHASE 2: STATIC EN GARDE AUDIT
    // -------------------------------------------------------------
    async function auditStaticEnGarde() {
        const vW = videoElement.videoWidth;
        const vH = videoElement.videoHeight;
        canvasOverlay.width = vW;
        canvasOverlay.height = vH;

        // Run MediaPipe in single-frame IMAGE mode
        const result = poseLandmarker.detect(videoElement);
        canvasCtx.clearRect(0, 0, vW, vH);

        if (!result.landmarks || result.landmarks.length === 0) {
            document.getElementById('clinicInstructionBanner').innerText = 'खेळाडू दिसला नाही. पूर्ण शरीर कॅमेऱ्यात दिसेल असे उभे राहा.';
            speakCoachingCue('कॅमेऱ्यासमोर थोडे मागे व्हा, पूर्ण शरीर दिसू द्या.');
            document.getElementById('clinicSoftGateControls').style.display = 'flex';
            return;
        }

        const lm = result.landmarks[0];

        // Determine fencer orientation (lead vs rear ankle)
        // 27 = Left Ankle, 28 = Right Ankle, 25 = Left Knee, 26 = Right Knee
        // 11 = Left Shoulder, 12 = Right Shoulder, 13 = Left Elbow, 14 = Right Elbow, 15 = Left Wrist, 16 = Right Wrist
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

        // Biomechanical Calculations
        const shoulderWidth = calculateDistance(lm[11], lm[12], vW, vH);
        const stanceWidth   = calculateDistance(leadAnkle, rearAnkle, vW, vH);
        const leadKneeAngle = calculateJointAngle(leadHip, leadKnee, leadAnkle, vW, vH);
        const rearKneeAngle = calculateJointAngle(rearHip, rearKnee, rearAnkle, vW, vH);
        const elbowAngle    = calculateJointAngle(leadShoulder, leadElbow, leadWrist, vW, vH);

        // Verification Thresholds
        const baseWidthRatio = stanceWidth / (shoulderWidth || 1);
        const isBaseValid    = baseWidthRatio >= 1.25 && baseWidthRatio <= 2.2;
        const isKneeSinkValid = leadKneeAngle >= 105 && leadKneeAngle <= 145;
        const isGuardArmValid = elbowAngle >= 80 && elbowAngle <= 135;

        // Visual Skeletal Markup
        drawJointMarker(leadKnee, vW, vH, isKneeSinkValid);
        drawJointMarker(leadAnkle, vW, vH, isBaseValid);
        drawJointMarker(leadElbow, vW, vH, isGuardArmValid);

        // Coaching Cues & Soft Gate
        const banner = document.getElementById('clinicInstructionBanner');
        if (!isKneeSinkValid) {
            banner.innerText = '⚠️ गुडघे थोडे अजून वाकवा, तोल मध्यभागी ठेवा!';
            speakCoachingCue('गुडघे थोडे अजून वाकवा, थोडे खाली बसा!');
        } else if (!isBaseValid) {
            banner.innerText = '⚠️ पायांमधील अंतर तपासा (~२.५ पावले अंतर ठेवा).';
            speakCoachingCue('पायांमध्ये योग्य अंतर ठेवा!');
        } else if (!isGuardArmValid) {
            banner.innerText = '⚠️ हात छातीच्या रेषेत ठेवा, कोपर सैल सोडा!';
            speakCoachingCue('हात छातीच्या रेषेत ठेवा!');
        } else {
            banner.innerText = '✅ उत्कृष्ट मूलभूत स्थिती! ३ स्टार पवित्रा.';
            speakCoachingCue('छान पोझिशन रीवा! आता लंजसाठी सज्ज व्हा.');
        }

        document.getElementById('clinicCountdown').innerText = 'स्थिती नोंदवली!';
        document.getElementById('clinicSoftGateControls').style.display = 'flex';

        stanceAuditResult = {
            isBaseValid,
            isKneeSinkValid,
            isGuardArmValid,
            baselineStanceWidth: stanceWidth
        };
    }

    function drawJointMarker(landmark, vW, vH, isValid) {
        canvasCtx.beginPath();
        canvasCtx.arc(landmark.x * vW, landmark.y * vH, 10, 0, 2 * Math.PI);
        canvasCtx.lineWidth = 3;
        canvasCtx.strokeStyle = isValid ? '#22c55e' : '#ef4444';
        canvasCtx.fillStyle = isValid ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.4)';
        canvasCtx.fill();
        canvasCtx.stroke();
    }

    // -------------------------------------------------------------
    // 6. COUNTDOWN STATE MACHINE
    // -------------------------------------------------------------
    function runStanceCountdown() {
        let count = 3;
        const badge = document.getElementById('clinicCountdown');
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

    // -------------------------------------------------------------
    // 7. PUBLIC INTERFACE (MODULE CONTRACT)
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
                if (b) b.innerText = 'मॉडेल किंवा कॅमेरा सुरू करताना त्रुटी आली. कृपया रिफ्रेश करा.';
            }
        },

        stop: () => {
            isRunning = false;
            clearInterval(countdownTimer);

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
            document.getElementById('clinicSoftGateControls').style.display = 'none';
            if (canvasCtx && canvasOverlay) {
                canvasCtx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
            }
            runStanceCountdown();
        },

        proceedToLunge: () => {
            document.getElementById('clinicInstructionBanner').innerText = 'गतिमान झेप (Dynamic Lunge Tracker) लवकरच सुरू होत आहे...';
            speakCoachingCue('आता रॉकेट लंज मारा!');
        }
    };
})();
