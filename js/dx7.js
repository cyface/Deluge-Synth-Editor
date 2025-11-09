// Deluge Synth Editor - DX7 Module
// Minimal DX7 FM synthesis support with patch loading and Deluge-specific parameters

// ============================================================================
// DX7 PATCH PARSING
// ============================================================================

/**
 * Parse DX7 SYSEX file and extract voice data
 * Supports both single voice (163 bytes) and 32-voice cartridge (4104 bytes)
 * Returns: { voiceData: Uint8Array(156), patchName: string, isCartridge: boolean, numPatches: number }
 */
function parseDX7Sysex(buffer) {
    const data = new Uint8Array(buffer);
    
    // Check for SYSEX start
    if (data[0] !== 0xF0) {
        throw new Error('Invalid SYSEX file - missing start byte (0xF0)');
    }
    
    // Find SYSEX end
    let sysexEnd = -1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] === 0xF7) {
            sysexEnd = i;
            break;
        }
    }
    
    if (sysexEnd === -1) {
        throw new Error('Invalid SYSEX file - missing end byte (0xF7)');
    }
    
    const msgSize = sysexEnd + 1;
    
    // Check Yamaha manufacturer ID (0x43)
    if (data[1] !== 0x43) {
        throw new Error('Not a Yamaha SYSEX file (expected manufacturer ID 0x43)');
    }
    
    // Determine if cartridge (4104 bytes) or single voice (163 bytes)
    const isCartridge = msgSize === 4104;
    const isSingleVoice = msgSize === 163;
    
    if (!isCartridge && !isSingleVoice) {
        throw new Error(`Invalid DX7 SYSEX size: ${msgSize} bytes (expected 163 or 4104)`);
    }
    
    // Check format byte: 0x09 = 32 voices, 0x00 = 1 voice
    if (data[3] !== 0x09 && data[3] !== 0x00) {
        throw new Error('Invalid DX7 format byte (expected 0x09 for cartridge or 0x00 for single voice)');
    }
    
    // Extract voice data (starts at byte 6)
    const voiceDataSize = isCartridge ? 4096 : 155;
    const voiceData = data.slice(6, 6 + voiceDataSize);
    
    // Verify checksum (byte before 0xF7)
    const checksumByte = data[sysexEnd - 1];
    const calculatedChecksum = calculateDX7Checksum(voiceData);
    if (checksumByte !== calculatedChecksum) {
        console.warn('DX7 checksum mismatch - file may be corrupted');
    }
    
    return {
        voiceData: voiceData,
        isCartridge: isCartridge,
        numPatches: isCartridge ? 32 : 1
    };
}

/**
 * Calculate DX7 checksum (sum of all bytes & 0x7F)
 */
function calculateDX7Checksum(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum = (sum - data[i]) & 0x7F;
    }
    return sum;
}

/**
 * Extract patch name from DX7 voice data
 * For cartridge: pass patch index (0-31)
 * For single voice: index is ignored
 */
function extractDX7PatchName(voiceData, patchIndex = 0, isCartridge = false) {
    let nameOffset;
    
    if (isCartridge) {
        // Cartridge: each patch is 128 bytes, name at bytes 118-127
        nameOffset = (patchIndex * 128) + 118;
    } else {
        // Single voice: 155 bytes, name at bytes 145-154
        nameOffset = 145;
    }
    
    // Extract 10 characters
    let name = '';
    for (let i = 0; i < 10; i++) {
        if (nameOffset + i >= voiceData.length) break;
        let char = voiceData[nameOffset + i] & 0x7F; // Strip MSB
        
        // Convert special characters
        if (char === 92) char = 89; // Yen -> Y
        else if (char === 126) char = 62; // >> -> >
        else if (char === 127) char = 60; // << -> <
        else if (char < 32 || char > 127) char = 32; // Invalid -> space
        
        name += String.fromCharCode(char);
    }
    
    return name.trim();
}

/**
 * Unpack a single voice from cartridge format (128 bytes) to unpacked format (155 bytes)
 * Based on Deluge firmware implementation
 */
function unpackDX7Voice(packedVoice) {
    const unpacked = new Uint8Array(155);
    
    // Unpack 6 operators (21 bytes each unpacked, 17 bytes packed)
    for (let op = 0; op < 6; op++) {
        const packedOffset = op * 17;
        const unpackedOffset = op * 21;
        
        // EG rates and levels (11 bytes)
        for (let i = 0; i < 11; i++) {
            unpacked[unpackedOffset + i] = packedVoice[packedOffset + i] & 0x7F;
        }
        
        // Keyboard scaling curves (packed into 1 byte)
        const curves = packedVoice[packedOffset + 11];
        unpacked[unpackedOffset + 11] = curves & 0x03;        // Left curve
        unpacked[unpackedOffset + 12] = (curves >> 2) & 0x03; // Right curve
        
        // Keyboard rate scaling and oscillator detune
        const scaleDetune = packedVoice[packedOffset + 12];
        unpacked[unpackedOffset + 13] = scaleDetune & 0x07;        // Oscillator detune
        unpacked[unpackedOffset + 20] = (scaleDetune >> 3) & 0x0F; // Rate scaling
        
        // Key velocity sensitivity and amp mod sensitivity
        const sensitivities = packedVoice[packedOffset + 13];
        unpacked[unpackedOffset + 14] = sensitivities & 0x03;      // Key velocity
        unpacked[unpackedOffset + 15] = (sensitivities >> 2) & 0x07; // Amp mod
        
        // Output level
        unpacked[unpackedOffset + 16] = packedVoice[packedOffset + 14];
        
        // Oscillator mode and coarse frequency
        const modeCoarse = packedVoice[packedOffset + 15];
        unpacked[unpackedOffset + 17] = modeCoarse & 0x01;        // Mode (fixed/ratio)
        unpacked[unpackedOffset + 18] = (modeCoarse >> 1) & 0x1F; // Coarse freq
        
        // Fine frequency
        unpacked[unpackedOffset + 19] = packedVoice[packedOffset + 16];
    }
    
    // Pitch EG, algorithm, etc. (9 bytes)
    for (let i = 0; i < 9; i++) {
        unpacked[126 + i] = packedVoice[102 + i] & 0x7F;
    }
    
    // Feedback and oscillator key sync
    const feedbackSync = packedVoice[111];
    unpacked[135] = feedbackSync & 0x07;      // Feedback
    unpacked[136] = (feedbackSync >> 3) & 0x01; // Oscillator sync
    
    // LFO (4 bytes)
    for (let i = 0; i < 4; i++) {
        unpacked[137 + i] = packedVoice[112 + i] & 0x7F;
    }
    
    // LFO routing
    const lfoRouting = packedVoice[116];
    unpacked[141] = lfoRouting & 0x01;         // LFO key sync
    unpacked[142] = (lfoRouting >> 1) & 0x07;  // LFO wave
    unpacked[143] = (lfoRouting >> 4) & 0x07;  // Pitch mod sensitivity
    
    // Transpose
    unpacked[144] = packedVoice[117];
    
    // Patch name (10 bytes)
    for (let i = 0; i < 10; i++) {
        unpacked[145 + i] = packedVoice[118 + i];
    }
    
    return unpacked;
}

/**
 * Extract algorithm number from unpacked voice data
 */
function extractDX7Algorithm(unpackedVoice) {
    return (unpackedVoice[134] & 0x1F) + 1; // Algorithm is 0-31, display as 1-32
}

/**
 * Extract feedback level from unpacked voice data
 */
function extractDX7Feedback(unpackedVoice) {
    return unpackedVoice[135] & 0x07; // Feedback is 0-7
}

/**
 * Extract oscillator sync state
 */
function extractDX7OscSync(unpackedVoice) {
    return (unpackedVoice[136] & 0x01) === 1;
}

/**
 * Convert 156-byte voice data to hex string for XML storage
 */
function voiceDataToHex(voiceData) {
    return Array.from(voiceData)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Convert hex string back to Uint8Array
 */
function hexToVoiceData(hexString) {
    const bytes = new Uint8Array(hexString.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
    }
    return bytes;
}

// ============================================================================
// DX7 UI FUNCTIONS
// ============================================================================

/**
 * Initialize DX7 UI for an oscillator
 */
function initializeDX7UI(oscNum) {
    const container = document.getElementById(`osc${oscNum}DX7Container`);
    if (!container) {
        console.error('DX7 container not found for OSC', oscNum);
        return;
    }
    
    container.style.display = 'block';
    updateDX7Display(oscNum);
    setupDX7EventListeners(oscNum);
}

/**
 * Setup event listeners for DX7 controls
 */
function setupDX7EventListeners(oscNum) {
    const engineSelect = document.getElementById(`osc${oscNum}DX7EngineMode`);
    if (engineSelect) {
        engineSelect.addEventListener('change', (e) => {
            currentState[`osc${oscNum}DX7EngineMode`] = e.target.value;
        });
    }
    
    const detuneSlider = document.getElementById(`osc${oscNum}DX7RandomDetune`);
    const detuneValue = document.getElementById(`osc${oscNum}DX7RandomDetuneValue`);
    if (detuneSlider && detuneValue) {
        detuneSlider.addEventListener('input', (e) => {
            const value = e.target.value;
            currentState[`osc${oscNum}DX7RandomDetune`] = value;
            detuneValue.textContent = value;
        });
    }
}

/**
 * Show cartridge patch selector
 * @param {Uint8Array} cartridgeData - 4096 bytes of cartridge voice data
 * @param {number} oscNum - Oscillator number
 * @param {string} sourceFile - Source .syx filepath
 */
function showDX7CartridgeSelector(cartridgeData, oscNum, sourceFile = '') {
    if (!oscNum || isNaN(oscNum)) {
        console.error('CRITICAL: oscNum is invalid:', oscNum);
        alert('Error: Oscillator number not specified. Please try clicking the Browse button again.');
        return;
    }
    
    const patches = [];
    for (let i = 0; i < 32; i++) {
        const name = extractDX7PatchName(cartridgeData, i, true);
        patches.push({ index: i, name: name });
    }
    
    // Create selector dialog
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <h2>Select DX7 Patch (32 patches in cartridge)</h2>
            <div style="max-height: 400px; overflow-y: auto; margin: 20px 0;">
                ${patches.map(p => `
                    <div class="dx7-patch-item" data-index="${p.index}" 
                         style="padding: 10px; cursor: pointer; border-bottom: 1px solid #333; background: #1a1a1a;"
                         onmouseover="this.style.background='#2a2a2a'"
                         onmouseout="this.style.background='#1a1a1a'">
                        <strong>${(p.index + 1).toString().padStart(2, '0')}.</strong> ${p.name}
                    </div>
                `).join('')}
            </div>
            <button onclick="closeDX7CartridgeSelector()">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(dialog);
    dialog.style.display = 'flex';
    
    // Store oscNum in dialog data for closure
    dialog.dataset.oscNum = oscNum;
    dialog.dataset.sourceFile = sourceFile;
    
    // Add click handlers
    const patchItems = dialog.querySelectorAll('.dx7-patch-item');
    
    patchItems.forEach((item, idx) => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            const targetOsc = parseInt(dialog.dataset.oscNum);
            const targetFile = dialog.dataset.sourceFile;
            
            
            try {
                const packedVoice = cartridgeData.slice(index * 128, (index + 1) * 128);
                
                const unpackedVoice = unpackDX7Voice(packedVoice);
                
                // Load voice with source file and patch index info
                loadDX7Voice(unpackedVoice, targetOsc, targetFile, index + 1);
                document.body.removeChild(dialog);
            } catch (error) {
                console.error('❌ Error loading patch:', error);
                alert('Error loading patch: ' + error.message);
            }
        });
    });
    
    // Store reference for cancel button
    window.currentDX7Dialog = dialog;
}

/**
 * Close cartridge selector
 */
function closeDX7CartridgeSelector() {
    if (window.currentDX7Dialog) {
        document.body.removeChild(window.currentDX7Dialog);
        window.currentDX7Dialog = null;
    }
}

/**
 * Load a DX7 voice into the current state
 * @param {Uint8Array} unpackedVoice - 155/156 byte voice data
 * @param {number} oscNum - Oscillator number (1 or 2)
 * @param {string} sourceFile - Optional source .syx filepath
 * @param {number} patchIndex - Optional patch index (1-32) if from cartridge
 */
function loadDX7Voice(unpackedVoice, oscNum, sourceFile = '', patchIndex = null) {
    
    // Make sure OSC type is set to dx7 and UI is initialized
    currentState[`osc${oscNum}Type`] = 'dx7';
    const typeSelect = document.getElementById(`osc${oscNum}Type`);
    if (typeSelect) {
        typeSelect.value = 'dx7';
    }
    
    // Initialize DX7 UI if not already done
    const container = document.getElementById(`osc${oscNum}DX7Container`);
    if (container && container.style.display === 'none') {
        initializeDX7UI(oscNum);
    }
    
    // Store as hex string
    const hexString = voiceDataToHex(unpackedVoice);
    currentState[`osc${oscNum}DX7Patch`] = hexString;
    
    // Store source info for display
    if (sourceFile) {
        currentState[`osc${oscNum}DX7SourceFile`] = sourceFile;
        currentState[`osc${oscNum}DX7PatchIndex`] = patchIndex ? patchIndex.toString() : '';
    }
    
    // Extract and display info
    updateDX7Display(oscNum);
    
}

/**
 * Update DX7 display with current patch info
 */
function updateDX7Display(oscNum) {
    
    const patchHex = currentState[`osc${oscNum}DX7Patch`];
    
    const infoElement = document.getElementById(`osc${oscNum}DX7Info`);
    if (!infoElement) {
        console.warn('⚠️ DX7 info element not found for OSC', oscNum);
        return;
    }
    
    // Show source path even if patch data is invalid
    const sourceFile = currentState[`osc${oscNum}DX7SourceFile`];
    const patchIndex = currentState[`osc${oscNum}DX7PatchIndex`];
    const sourcePathEl = document.getElementById(`osc${oscNum}DX7SourcePath`);
    
    if (sourcePathEl && sourceFile) {
        let sourceText = sourceFile;
        if (patchIndex) {
            sourceText += ` (Patch #${patchIndex})`;
        }
        sourcePathEl.textContent = sourceText;
    }
    
    // Check for valid patch data (155 or 156 bytes = 310 or 312 hex chars)
    if (!patchHex || (patchHex.length !== 310 && patchHex.length !== 312)) {
        // Still show the info container if we have source file
        if (sourceFile) {
            infoElement.style.display = 'block';
        } else {
            infoElement.style.display = 'none';
        }
        return;
    }
    
    const voiceData = hexToVoiceData(patchHex);
    
    // Extract info
    const name = extractDX7PatchName(voiceData, 0, false);
    const algorithm = extractDX7Algorithm(voiceData);
    const feedback = extractDX7Feedback(voiceData);
    const oscSync = extractDX7OscSync(voiceData);
    
    
    // Update UI with null checks
    const nameEl = document.getElementById(`osc${oscNum}DX7PatchName`);
    const algoEl = document.getElementById(`osc${oscNum}DX7Algorithm`);
    const feedbackEl = document.getElementById(`osc${oscNum}DX7Feedback`);
    const syncEl = document.getElementById(`osc${oscNum}DX7OscSync`);
    
    if (nameEl) nameEl.textContent = name;
    if (algoEl) algoEl.textContent = algorithm;
    if (feedbackEl) feedbackEl.textContent = feedback;
    if (syncEl) syncEl.textContent = oscSync ? 'ON' : 'OFF';
    
    infoElement.style.display = 'block';
    
    // Update engine mode display
    const engineMode = currentState[`osc${oscNum}DX7EngineMode`] || '0';
    const engineSelect = document.getElementById(`osc${oscNum}DX7EngineMode`);
    if (engineSelect) {
        engineSelect.value = engineMode;
    }
    
    // Update random detune display
    const randomDetune = currentState[`osc${oscNum}DX7RandomDetune`] || '0';
    const detuneSlider = document.getElementById(`osc${oscNum}DX7RandomDetune`);
    const detuneValue = document.getElementById(`osc${oscNum}DX7RandomDetuneValue`);
    if (detuneSlider && detuneValue) {
        detuneSlider.value = randomDetune;
        detuneValue.textContent = randomDetune;
    }
}

/**
 * Clear DX7 patch
 */
function clearDX7Patch(oscNum) {
    currentState[`osc${oscNum}DX7Patch`] = '';
    currentState[`osc${oscNum}DX7EngineMode`] = '0';
    currentState[`osc${oscNum}DX7RandomDetune`] = '0';
    currentState[`osc${oscNum}DX7SourceFile`] = '';
    currentState[`osc${oscNum}DX7PatchIndex`] = '';
    updateDX7Display(oscNum);
    showNotification(`✓ Cleared DX7 patch from OSC${oscNum}`);
}

