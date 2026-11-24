// app.js - Complete improved version
console.log("VisionBot AI - Real-time Object Detection");

// DOM Elements
const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const detectBtn = document.getElementById('detectBtn');
const snapshotBtn = document.getElementById('snapshotBtn');
const stopBtn = document.getElementById('stopBtn');
const resultsDiv = document.getElementById('results');
const statusDiv = document.getElementById('status');
const objectCount = document.getElementById('objectCount');
const fpsCounter = document.getElementById('fpsCounter');
const confidenceAvg = document.getElementById('confidenceAvg');
const lastDetectionTime = document.getElementById('lastDetectionTime');

// Variables
let model = null;
let stream = null;
let isDetecting = false;
let ctx = null;
let frameCount = 0;
let lastFpsUpdate = Date.now();
let currentFps = 0;
let lastDetections = [];

// Voice announcement state
const announcedObjects = new Map();
const VOICE_CONFIDENCE_THRESHOLD = 0.55;
const OBJECT_DISAPPEAR_RESET_MS = 2500;
let speechQueue = [];
let isSpeaking = false;

function enqueueObjectAnnouncement(objectName) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
        console.warn('Text-to-Speech is not supported in this WebView.');
        return;
    }
    speechQueue.push(objectName);
    speakNextObject();
}

function speakNextObject() {
    if (isSpeaking || speechQueue.length === 0 || !('speechSynthesis' in window)) return;
    const objectName = speechQueue.shift();
    const utterance = new SpeechSynthesisUtterance(`${objectName} detected`);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    isSpeaking = true;
    utterance.onend = () => { isSpeaking = false; speakNextObject(); };
    utterance.onerror = () => { isSpeaking = false; speakNextObject(); };
    window.speechSynthesis.speak(utterance);
}

function announceNewObjects(predictions) {
    const now = Date.now();
    const currentlyVisible = new Set();

    predictions.forEach(prediction => {
        if (prediction.score < VOICE_CONFIDENCE_THRESHOLD) return;

        const objectName = prediction.class;
        currentlyVisible.add(objectName);
        const previous = announcedObjects.get(objectName);

        // Announce only on first appearance or after the object has been absent.
        if (!previous || now - previous.lastSeen > OBJECT_DISAPPEAR_RESET_MS) {
            enqueueObjectAnnouncement(objectName);
        }
        announcedObjects.set(objectName, { lastSeen: now });
    });

    // Forget objects that have been absent long enough, so they can be announced
    // again if they return to the camera view.
    for (const [objectName, state] of announcedObjects.entries()) {
        if (!currentlyVisible.has(objectName) && now - state.lastSeen > OBJECT_DISAPPEAR_RESET_MS) {
            announcedObjects.delete(objectName);
        }
    }
}

// Color palette for bounding boxes
const colors = [
    '#FF5252', '#FF4081', '#E040FB', '#7C4DFF',
    '#536DFE', '#448AFF', '#40C4FF', '#18FFFF',
    '#64FFDA', '#69F0AE', '#B2FF59', '#EEFF41',
    '#FFFF00', '#FFD740', '#FFAB40', '#FF6E40'
];

// 1. Load ML Model
async function loadModel() {
    statusDiv.textContent = '⏳ Loading AI model...';
    statusDiv.style.background = '#FFF3E0';
    statusDiv.style.color = '#EF6C00';
    
    try {
        model = await cocoSsd.load();
        statusDiv.textContent = '✅ Model loaded successfully!';
        statusDiv.style.background = '#E8F5E9';
        statusDiv.style.color = '#2E7D32';
        console.log("Model loaded!");
        detectBtn.disabled = false;
    } catch (error) {
        statusDiv.textContent = '❌ Failed to load model: ' + error.message;
        statusDiv.style.background = '#FFEBEE';
        statusDiv.style.color = '#C62828';
        console.error("Error loading model:", error);
    }
}

// 2. Start Webcam
async function startWebcam() {
    statusDiv.textContent = '⏳ Starting camera...';
    statusDiv.style.background = '#FFF3E0';
    statusDiv.style.color = '#EF6C00';
    
    try {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'environment',
                frameRate: { ideal: 30 }
            },
            audio: false
        };
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        video.srcObject = stream;
        
        // Wait for video to be ready
        video.onloadedmetadata = () => {
            // Set canvas dimensions to match video
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
            ctx = overlay.getContext('2d');
            
            startBtn.disabled = true;
            snapshotBtn.disabled = false;
            stopBtn.disabled = false;
            
            statusDiv.textContent = '✅ Camera active';
            statusDiv.style.background = '#E8F5E9';
            statusDiv.style.color = '#2E7D32';
            
            // Start FPS counter
            setInterval(updateFPS, 1000);
            
            // Load model after camera starts
            if (!model) {
                loadModel();
            }
        };
        
    } catch (error) {
        statusDiv.textContent = '❌ Camera access denied or error: ' + error.message;
        statusDiv.style.background = '#FFEBEE';
        statusDiv.style.color = '#C62828';
        console.error("Error accessing camera:", error);
        
        // Show fallback image or message
        resultsDiv.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #C62828;">
                <h4>⚠️ Camera Error</h4>
                <p>Please allow camera permissions and refresh the page.</p>
                <p>Common fixes:</p>
                <ul style="text-align: left; display: inline-block;">
                    <li>Check browser permissions</li>
                    <li>Make sure no other app is using camera</li>
                    <li>Try using Chrome or Firefox</li>
                </ul>
            </div>
        `;
    }
}

// 3. FPS Counter
function updateFPS() {
    const now = Date.now();
    const elapsed = (now - lastFpsUpdate) / 1000;
    currentFps = Math.round(frameCount / elapsed);
    fpsCounter.textContent = currentFps;
    frameCount = 0;
    lastFpsUpdate = now;
}

// 4. Detect Objects
async function detectObjects() {
    if (!model || !video.srcObject) {
        alert("Please start camera first!");
        return;
    }
    
    frameCount++;
    
    isDetecting = true;
    detectBtn.disabled = true;
    detectBtn.innerHTML = '<span>⏳</span> Detecting...';
    statusDiv.textContent = '🤖 Detecting objects...';
    statusDiv.style.background = '#E3F2FD';
    statusDiv.style.color = '#1565C0';
    
    try {
        // Clear previous drawings
        if (ctx) {
            ctx.clearRect(0, 0, overlay.width, overlay.height);
        }
        
        // Perform detection
        const startTime = performance.now();
        const predictions = await model.detect(video);
        const detectionTime = performance.now() - startTime;
        
        // Announce newly detected objects
        announceNewObjects(predictions);

        // Store last detections
        lastDetections = predictions;
        
        // Update stats
        updateStats(predictions, detectionTime);
        
        // Draw bounding boxes
        drawBoundingBoxes(predictions);
        
        // Display results
        displayResults(predictions);
        
        // Update timestamp
        const now = new Date();
        lastDetectionTime.textContent = now.toLocaleTimeString();
        
        // Continue detecting if still enabled
        if (isDetecting) {
            requestAnimationFrame(detectObjects);
        }
    } catch (error) {
        console.error("Detection error:", error);
        statusDiv.textContent = '❌ Detection failed: ' + error.message;
        statusDiv.style.background = '#FFEBEE';
        statusDiv.style.color = '#C62828';
        isDetecting = false;
    }
    
    detectBtn.disabled = false;
    detectBtn.innerHTML = '<span>🤖</span> Detect Objects';
}

// 5. Draw Bounding Boxes
function drawBoundingBoxes(predictions) {
    if (!ctx || predictions.length === 0) return;
    
    const scaleX = overlay.width / video.videoWidth;
    const scaleY = overlay.height / video.videoHeight;
    
    predictions.forEach((prediction, index) => {
        const color = colors[index % colors.length];
        const [x, y, width, height] = prediction.bbox;
        
        // Scale coordinates to canvas size
        const scaledX = x * scaleX;
        const scaledY = y * scaleY;
        const scaledWidth = width * scaleX;
        const scaledHeight = height * scaleY;
        
        // Draw rectangle
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight);
        
        // Draw label background
        const label = `${prediction.class} ${Math.round(prediction.score * 100)}%`;
        ctx.font = 'bold 16px Arial';
        const textWidth = ctx.measureText(label).width;
        
        // Rounded rectangle for label
        const labelX = scaledX;
        const labelY = scaledY - 25;
        const labelWidth = textWidth + 20;
        const labelHeight = 22;
        const radius = 5;
        
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(labelX + radius, labelY);
        ctx.lineTo(labelX + labelWidth - radius, labelY);
        ctx.quadraticCurveTo(labelX + labelWidth, labelY, labelX + labelWidth, labelY + radius);
        ctx.lineTo(labelX + labelWidth, labelY + labelHeight - radius);
        ctx.quadraticCurveTo(labelX + labelWidth, labelY + labelHeight, labelX + labelWidth - radius, labelY + labelHeight);
        ctx.lineTo(labelX + radius, labelY + labelHeight);
        ctx.quadraticCurveTo(labelX, labelY + labelHeight, labelX, labelY + labelHeight - radius);
        ctx.lineTo(labelX, labelY + radius);
        ctx.quadraticCurveTo(labelX, labelY, labelX + radius, labelY);
        ctx.closePath();
        ctx.fill();
        
        // Draw label text
        ctx.fillStyle = 'white';
        ctx.fillText(label, labelX + 10, labelY + 16);
    });
}

// 6. Update Statistics
function updateStats(predictions, detectionTime) {
    // Update object count
    objectCount.textContent = predictions.length;
    
    // Update average confidence
    if (predictions.length > 0) {
        const avgConfidence = predictions.reduce((sum, p) => sum + p.score, 0) / predictions.length;
        confidenceAvg.textContent = Math.round(avgConfidence * 100) + '%';
        
        // Change color based on confidence
        if (avgConfidence > 0.7) {
            confidenceAvg.style.color = '#4CAF50';
        } else if (avgConfidence > 0.4) {
            confidenceAvg.style.color = '#FF9800';
        } else {
            confidenceAvg.style.color = '#F44336';
        }
    } else {
        confidenceAvg.textContent = '0%';
        confidenceAvg.style.color = '#666';
    }
    
    // Update status
    statusDiv.textContent = `✅ Found ${predictions.length} object(s) in ${detectionTime.toFixed(0)}ms`;
    statusDiv.style.background = '#E8F5E9';
    statusDiv.style.color = '#2E7D32';
}

// 7. Display Results
function displayResults(predictions) {
    if (predictions.length === 0) {
        resultsDiv.innerHTML = `
            <div class="result-item" style="border-left-color: #999;">
                <span>No objects detected</span>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: 0%"></div>
                </div>
                <span>0%</span>
            </div>
        `;
        return;
    }
    
    // Sort by confidence (highest first)
    predictions.sort((a, b) => b.score - a.score);
    
    let resultsHTML = '';
    predictions.forEach((prediction, index) => {
        const confidence = Math.round(prediction.score * 100);
        const color = colors[index % colors.length];
        
        resultsHTML += `
            <div class="result-item" style="border-left-color: ${color};">
                <span style="font-weight: bold;">${prediction.class}</span>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${confidence}%"></div>
                </div>
                <span>${confidence}%</span>
            </div>
        `;
    });
    
    resultsDiv.innerHTML = resultsHTML;
}

// 8. Take Snapshot
function takeSnapshot() {
    if (!video.srcObject) {
        alert("Please start camera first!");
        return;
    }
    
    // Create temporary canvas
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    
    // Draw video frame
    tempCtx.drawImage(video, 0, 0);
    
    // Draw bounding boxes if available
    if (lastDetections.length > 0) {
        lastDetections.forEach((prediction, index) => {
            const color = colors[index % colors.length];
            const [x, y, width, height] = prediction.bbox;
            
            tempCtx.strokeStyle = color;
            tempCtx.lineWidth = 3;
            tempCtx.strokeRect(x, y, width, height);
            
            const label = `${prediction.class} ${Math.round(prediction.score * 100)}%`;
            tempCtx.font = 'bold 16px Arial';
            const textWidth = tempCtx.measureText(label).width;
            
            tempCtx.fillStyle = color;
            tempCtx.fillRect(x, y - 25, textWidth + 20, 25);
            
            tempCtx.fillStyle = 'white';
            tempCtx.fillText(label, x + 10, y - 8);
        });
    }
    
    // Create download link
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `visionbot-snapshot-${timestamp}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
    
    // Show feedback
    const originalText = snapshotBtn.innerHTML;
    snapshotBtn.innerHTML = '<span>✅</span> Saved!';
    statusDiv.textContent = `📸 Snapshot saved as ${link.download}`;
    statusDiv.style.background = '#FFF3E0';
    statusDiv.style.color = '#EF6C00';
    
    setTimeout(() => {
        snapshotBtn.innerHTML = originalText;
    }, 2000);
}

// 9. Stop Everything
function stopAll() {
    isDetecting = false;
    speechQueue = [];
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    isSpeaking = false;
    announcedObjects.clear();
    
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        stream = null;
    }
    
    if (ctx) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
    
    startBtn.disabled = false;
    detectBtn.disabled = true;
    snapshotBtn.disabled = true;
    stopBtn.disabled = true;
    
    detectBtn.innerHTML = '<span>🤖</span> Detect Objects';
    
    statusDiv.textContent = '⏸️ Detection stopped. Click "Start Camera" to begin again.';
    statusDiv.style.background = '#F5F5F5';
    statusDiv.style.color = '#666';
    
    // Reset stats
    objectCount.textContent = '0';
    fpsCounter.textContent = '0';
    confidenceAvg.textContent = '0%';
    confidenceAvg.style.color = '#666';
    lastDetectionTime.textContent = 'Never';
    
    resultsDiv.innerHTML = `
        <p style="color: #999; text-align: center; padding: 20px;">
            Detection stopped. Click "Start Camera" to begin again.
        </p>
    `;
}

// 10. Event Listeners
startBtn.addEventListener('click', startWebcam);
detectBtn.addEventListener('click', () => {
    if (!isDetecting) {
        detectObjects();
    }
});
snapshotBtn.addEventListener('click', takeSnapshot);
stopBtn.addEventListener('click', stopAll);

// 11. Handle visibility change
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isDetecting) {
        console.log('Tab hidden, pausing detection');
        isDetecting = false;
        detectBtn.innerHTML = '<span>🤖</span> Detect Objects';
        detectBtn.disabled = false;
    }
});

// 12. Initial Load
window.addEventListener('load', () => {
    console.log("VisionBot AI initialized!");
    
    // Check for camera support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusDiv.textContent = '❌ Your browser does not support camera access';
        statusDiv.style.background = '#FFEBEE';
        statusDiv.style.color = '#C62828';
        startBtn.disabled = true;
    }
    
    // Check for TensorFlow.js support
    if (!tf) {
        statusDiv.textContent = '❌ TensorFlow.js not loaded. Check internet connection.';
        statusDiv.style.background = '#FFEBEE';
        statusDiv.style.color = '#C62828';
    }
});