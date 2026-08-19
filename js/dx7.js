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
        unpacked[unpackedOffset + 13] = scaleDetune & 0x07;        // Rate scaling
        unpacked[unpackedOffset + 20] = (scaleDetune >> 3) & 0x0F; // Oscillator detune

        // Amp mod sensitivity and key velocity sensitivity
        const sensitivities = packedVoice[packedOffset + 13];
        unpacked[unpackedOffset + 14] = sensitivities & 0x03;      // Amp mod sens
        unpacked[unpackedOffset + 15] = (sensitivities >> 2) & 0x07; // Key velocity sens
        
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

// The Deluge stores a DX7 patch as the 155-byte unpacked VCED voice plus one
// trailing operator-enable byte (bit per operator, all on = 0x3F). The firmware
// reads exactly 156 bytes from the dx7patch attribute.
const DX7_VOICE_SIZE = 155;
const DX7_PATCH_SIZE = 156;
const DX7_ALL_OPS_ON = 0x3F;

/**
 * Normalize a dx7patch hex string to the firmware's 156-byte uppercase form.
 * Accepts 155-byte patches (from older editor versions / raw VCED) and appends
 * the all-operators-on enable byte. Returns '' if the string isn't a patch.
 */
function normalizeDX7PatchHex(hexString) {
    if (!hexString) return '';
    const hex = hexString.trim().toUpperCase();
    if (!/^[0-9A-F]+$/.test(hex)) return '';
    if (hex.length === DX7_PATCH_SIZE * 2) return hex;
    if (hex.length === DX7_VOICE_SIZE * 2) return hex + '3F';
    return '';
}

/**
 * Convert 156-byte voice data to hex string for XML storage
 * (uppercase, matching what the firmware itself writes)
 */
function voiceDataToHex(voiceData) {
    return Array.from(voiceData)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
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
    
    // Store as hex string, padded to the 156-byte form the firmware expects
    // (155 VCED bytes + operator-enable byte, all operators on)
    let patchBytes = unpackedVoice;
    if (patchBytes.length === DX7_VOICE_SIZE) {
        patchBytes = new Uint8Array(DX7_PATCH_SIZE);
        patchBytes.set(unpackedVoice);
        patchBytes[DX7_VOICE_SIZE] = DX7_ALL_OPS_ON;
    }
    currentState[`osc${oscNum}DX7Patch`] = voiceDataToHex(patchBytes);
    
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

// ============================================================================
// DX7 LOCAL FILE LOADING
// ============================================================================

/**
 * Load a DX7 .syx file from the local computer (as opposed to browsing the
 * Deluge's SD card). Banks open the cartridge patch selector; single-voice
 * dumps load directly.
 */
function loadDX7SyxFromComputer(oscNum) {
    let input = document.getElementById('dx7SyxFileInput');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'dx7SyxFileInput';
        input.accept = '.syx,.SYX';
        input.style.display = 'none';
        document.body.appendChild(input);
    }

    input.onchange = async (e) => {
        const file = e.target.files[0];
        input.value = '';
        if (!file) return;

        try {
            const parsed = parseDX7Sysex(await file.arrayBuffer());
            if (parsed.isCartridge) {
                showDX7CartridgeSelector(parsed.voiceData, oscNum, file.name);
            } else {
                loadDX7Voice(parsed.voiceData, oscNum, file.name);
                showNotification(`✓ Loaded DX7 voice into OSC${oscNum}`);
            }
        } catch (error) {
            console.error('Error loading DX7 sysex:', error);
            alert('Error loading DX7 sysex: ' + error.message);
        }
    };

    input.click();
}

/**
 * Build a standard 163-byte DX7 single-voice sysex dump from 155 VCED bytes:
 * F0 43 00 00 01 1B <155 voice bytes> <checksum> F7
 */
function buildDX7SingleVoiceSyx(voiceBytes) {
    const syx = new Uint8Array(163);
    syx.set([0xF0, 0x43, 0x00, 0x00, 0x01, 0x1B], 0);
    syx.set(voiceBytes.slice(0, DX7_VOICE_SIZE), 6);
    syx[161] = calculateDX7Checksum(voiceBytes.slice(0, DX7_VOICE_SIZE));
    syx[162] = 0xF7;
    return syx;
}

/**
 * Download the oscillator's DX7 voice as a single-voice .syx file, usable in
 * external editors (Dexed, etc.) or on a real DX7. The Deluge-only operator
 * enable byte is not part of the sysex format and is dropped.
 */
function downloadDX7Syx(oscNum) {
    const hex = normalizeDX7PatchHex(currentState[`osc${oscNum}DX7Patch`]);
    if (!hex) {
        alert(`No DX7 patch loaded on OSC${oscNum} - load or init one first.`);
        return;
    }
    const voiceBytes = hexToVoiceData(hex);
    const name = extractDX7PatchName(voiceBytes, 0, false) || 'DX7 VOICE';
    const filename = name.replace(/[/\\:*?"<>|]/g, '-') + '.syx';

    const blob = new Blob([buildDX7SingleVoiceSyx(voiceBytes)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showNotification(`✓ Downloaded ${filename}`);
}

// ============================================================================
// DX7 PATCH EDITOR
// ============================================================================

// Carrier operators (1-based) per algorithm, derived from the firmware's
// FmCore::algorithms table (ops with output bus ADD).
const DX7_CARRIERS = [
    [1,3], [1,3], [1,4], [1,4], [1,3,5], [1,3,5], [1,3], [1,3], [1,3], [1,4],
    [1,4], [1,3], [1,3], [1,3], [1,3], [1], [1], [1], [1,4,5], [1,2,4],
    [1,2,4,5], [1,3,4,5], [1,2,4,5], [1,2,3,4,5], [1,2,3,4,5], [1,2,4], [1,2,4],
    [1,3,6], [1,2,3,5], [1,2,3,6], [1,2,3,4,5], [1,2,3,4,5,6]
];

const DX7_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DX7_CURVE_NAMES = ['-LIN', '-EXP', '+EXP', '+LIN'];
const DX7_LFO_WAVES = ['Triangle', 'Saw Down', 'Saw Up', 'Square', 'Sine', 'S & Hold'];

// In VCED data the operators are stored in reverse order: OP6 occupies
// bytes 0-20 and OP1 bytes 105-125. The enable bit in byte 155 uses the
// same slot index (OP1 = bit 5 ... OP6 = bit 0).
function dx7OpOffset(opNum) {
    return (6 - opNum) * 21;
}

function dx7OpEnableBit(opNum) {
    return 6 - opNum;
}

/** Keyboard scaling break point: 0 = A-1, 39 = C3, 99 = C8 */
function dx7BreakpointName(value) {
    const n = value + 9;
    return DX7_NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

/** Transpose: 0-48, 24 = C3 */
function dx7TransposeName(value) {
    return DX7_NOTE_NAMES[value % 12] + (Math.floor(value / 12) + 1);
}

/**
 * Create the classic DX7 "INIT VOICE" patch (156 bytes including the
 * operator-enable byte) so editing can start from scratch.
 */
function createDX7InitVoice() {
    const v = new Uint8Array(DX7_PATCH_SIZE);
    for (let op = 1; op <= 6; op++) {
        const o = dx7OpOffset(op);
        v.set([99, 99, 99, 99, 99, 99, 99, 0], o); // EG rates 99, levels 99/99/99/0
        v[o + 8] = 39;  // break point C3
        v[o + 16] = 0;  // output level (off)
        v[o + 18] = 1;  // frequency coarse = ratio 1.00
        v[o + 20] = 7;  // detune centered
    }
    v[dx7OpOffset(1) + 16] = 99; // only the carrier OP1 is audible
    v.set([99, 99, 99, 99, 50, 50, 50, 50], 126); // pitch EG: flat
    v[136] = 1;  // oscillator key sync on
    v[137] = 35; // LFO speed
    v[141] = 1;  // LFO key sync on
    v[143] = 3;  // pitch mod sensitivity
    v[144] = 24; // transpose C3
    const name = 'INIT VOICE';
    for (let i = 0; i < 10; i++) {
        v[145 + i] = name.charCodeAt(i) || 32;
    }
    v[155] = DX7_ALL_OPS_ON;
    return v;
}

/**
 * Replace the oscillator's patch with INIT VOICE and open the editor
 */
function initDX7Patch(oscNum) {
    currentState[`osc${oscNum}Type`] = 'dx7';
    currentState[`osc${oscNum}DX7Patch`] = voiceDataToHex(createDX7InitVoice());
    currentState[`osc${oscNum}DX7SourceFile`] = '';
    currentState[`osc${oscNum}DX7PatchIndex`] = '';
    const sourcePathEl = document.getElementById(`osc${oscNum}DX7SourcePath`);
    if (sourcePathEl) sourcePathEl.textContent = '-';
    updateDX7Display(oscNum);
    openDX7Editor(oscNum);
}

// Editor state: which oscillator is being edited and a working copy of its
// 156 patch bytes. Every change is committed straight back to currentState.
let dx7EditorOsc = null;
let dx7EditorBytes = null;

// Operator parameter rows, grouped like the firmware's DX operator menu.
// Offsets are within one operator's 21-byte block.
const DX7_OP_SECTIONS = [
    { title: 'Envelope', rows: [
        { label: 'EG Rate 1', off: 0, max: 99 },
        { label: 'EG Rate 2', off: 1, max: 99 },
        { label: 'EG Rate 3', off: 2, max: 99 },
        { label: 'EG Rate 4', off: 3, max: 99 },
        { label: 'EG Level 1', off: 4, max: 99 },
        { label: 'EG Level 2', off: 5, max: 99 },
        { label: 'EG Level 3', off: 6, max: 99 },
        { label: 'EG Level 4', off: 7, max: 99 },
    ]},
    { title: 'Frequency', rows: [
        { label: 'Mode', off: 17, options: ['Ratio', 'Fixed'] },
        { label: 'Coarse', off: 18, max: 31 },
        { label: 'Fine', off: 19, max: 99 },
        { label: 'Detune', off: 20, detune: true },
    ]},
    { title: 'Level & Sensitivity', rows: [
        { label: 'Output Level', off: 16, max: 99 },
        { label: 'Velocity Sens', off: 15, max: 7 },
        { label: 'Amp Mod Sens', off: 14, max: 3 },
    ]},
    { title: 'Keyboard Scaling', rows: [
        { label: 'Break Point', off: 8, breakpoint: true },
        { label: 'Depth L', off: 9, max: 99 },
        { label: 'Depth R', off: 10, max: 99 },
        { label: 'Curve L', off: 11, options: DX7_CURVE_NAMES },
        { label: 'Curve R', off: 12, options: DX7_CURVE_NAMES },
        { label: 'Rate Scaling', off: 13, max: 7 },
    ]},
];

function dx7EditorNumberInput(off, max, value) {
    return `<input type="number" id="dx7p${off}" class="dx7-p" data-off="${off}" min="0" max="${max}" value="${value}">`;
}

function dx7EditorSelect(off, labels, value, valueOffset = 0) {
    const options = labels.map((label, i) =>
        `<option value="${i + valueOffset}" ${i + valueOffset === value ? 'selected' : ''}>${label}</option>`
    ).join('');
    return `<select id="dx7p${off}" class="dx7-p" data-off="${off}">${options}</select>`;
}

function dx7EditorCellHTML(row, opNum) {
    const off = dx7OpOffset(opNum) + row.off;
    const value = dx7EditorBytes[off];
    if (row.options) {
        return dx7EditorSelect(off, row.options, value);
    }
    if (row.detune) {
        // stored 0-14, displayed -7..+7
        const labels = [];
        for (let i = 0; i <= 14; i++) labels.push(i > 7 ? `+${i - 7}` : `${i - 7}`);
        return dx7EditorSelect(off, labels, value);
    }
    if (row.breakpoint) {
        const labels = [];
        for (let i = 0; i <= 99; i++) labels.push(dx7BreakpointName(i));
        return dx7EditorSelect(off, labels, value);
    }
    return dx7EditorNumberInput(off, row.max, value);
}

/**
 * Computed frequency readout for one operator (ratio or fixed Hz),
 * matching the firmware's DxVoice::osc_freq behavior.
 */
function dx7FreqText(bytes, opNum) {
    const o = dx7OpOffset(opNum);
    const mode = bytes[o + 17];
    const coarse = bytes[o + 18];
    const fine = bytes[o + 19];
    if (mode === 0) {
        const ratio = (coarse === 0 ? 0.5 : coarse) * (1 + fine / 100);
        return '×' + ratio.toFixed(2);
    }
    const freq = Math.pow(10, (coarse & 3) + fine / 100);
    return freq >= 1000 ? (freq / 1000).toFixed(2) + ' kHz' : freq.toFixed(2) + ' Hz';
}

function updateDX7FreqReadouts() {
    for (let op = 1; op <= 6; op++) {
        const el = document.getElementById(`dx7FreqReadout${op}`);
        if (el) el.textContent = dx7FreqText(dx7EditorBytes, op);
    }
}

function updateDX7CarrierHint() {
    const el = document.getElementById('dx7CarrierHint');
    if (el) {
        const algo = dx7EditorBytes[134] & 0x1F;
        el.textContent = 'Carriers: OP ' + DX7_CARRIERS[algo].join(', ');
    }
}

/**
 * Open the DX7 patch editor modal for an oscillator. If the oscillator has
 * no (or invalid) patch data, editing starts from INIT VOICE.
 */
function openDX7Editor(oscNum) {
    let hex = normalizeDX7PatchHex(currentState[`osc${oscNum}DX7Patch`]);
    if (!hex) {
        hex = voiceDataToHex(createDX7InitVoice());
        currentState[`osc${oscNum}DX7Patch`] = hex;
        updateDX7Display(oscNum);
    }

    dx7EditorOsc = oscNum;
    dx7EditorBytes = hexToVoiceData(hex);

    closeDX7Editor(); // in case one is already open

    const modal = document.createElement('div');
    modal.className = 'modal show dx7-editor';
    modal.id = 'dx7EditorModal';
    modal.innerHTML = buildDX7EditorHTML(oscNum);
    document.body.appendChild(modal);

    // Commit edits as they happen
    modal.addEventListener('change', onDX7EditorChange);
    // Close when clicking the backdrop (but not the content)
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeDX7Editor();
    });

    updateDX7FreqReadouts();
    updateDX7CarrierHint();
}

function buildDX7EditorHTML(oscNum) {
    const b = dx7EditorBytes;
    const name = extractDX7PatchName(b, 0, false);

    // Per-operator table: OP1..OP6 columns, parameter rows in sections
    const opHeaders = [];
    for (let op = 1; op <= 6; op++) {
        const enabled = (b[155] >> dx7OpEnableBit(op)) & 1;
        opHeaders.push(`<th>OP${op}<br><label style="font-weight: normal;" title="Operator on/off (Deluge extension)">` +
            `<input type="checkbox" id="dx7OpEn${op}" class="dx7-op-en" data-bit="${dx7OpEnableBit(op)}" ${enabled ? 'checked' : ''}> on</label></th>`);
    }

    let tableRows = '';
    for (const section of DX7_OP_SECTIONS) {
        tableRows += `<tr class="dx7-section-row"><td colspan="7">${section.title}</td></tr>`;
        for (const row of section.rows) {
            let cells = '';
            for (let op = 1; op <= 6; op++) {
                cells += `<td>${dx7EditorCellHTML(row, op)}</td>`;
            }
            tableRows += `<tr><td>${row.label}</td>${cells}</tr>`;
        }
        if (section.title === 'Frequency') {
            let cells = '';
            for (let op = 1; op <= 6; op++) {
                cells += `<td id="dx7FreqReadout${op}"></td>`;
            }
            tableRows += `<tr class="dx7-freq-row"><td>= Frequency</td>${cells}</tr>`;
        }
    }

    // Global controls
    const algoLabels = [];
    for (let i = 1; i <= 32; i++) algoLabels.push(`${i}`);
    const transposeLabels = [];
    for (let i = 0; i <= 48; i++) transposeLabels.push(dx7TransposeName(i));

    const pitchEG = ['Rate 1', 'Rate 2', 'Rate 3', 'Rate 4', 'Level 1', 'Level 2', 'Level 3', 'Level 4']
        .map((label, i) =>
            `<div class="control-group"><label class="control-label" for="dx7p${126 + i}">${label}</label>${dx7EditorNumberInput(126 + i, 99, b[126 + i])}</div>`
        ).join('');

    return `
        <div class="modal-content dx7-editor-content">
            <div class="modal-header">
                <div class="modal-title">DX7 Patch Editor — OSC${oscNum}</div>
                <button class="close-btn" onclick="closeDX7Editor()">✕</button>
            </div>

            <div class="controls-grid" style="margin-bottom: 15px;">
                <div class="control-group">
                    <label class="control-label" for="dx7Name">Patch Name (10 chars)</label>
                    <input type="text" id="dx7Name" class="dx7-name" maxlength="10" value="${name.replace(/"/g, '&quot;')}">
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p134">Algorithm <span id="dx7CarrierHint" style="color: #888; font-weight: normal;"></span></label>
                    ${dx7EditorSelect(134, algoLabels, b[134] & 0x1F)}
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p135">Feedback (0-7)</label>
                    ${dx7EditorNumberInput(135, 7, b[135])}
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p136" title="Restart all operator phases on each note-on">Osc Key Sync</label>
                    <label><input type="checkbox" id="dx7p136" class="dx7-p" data-off="136" ${b[136] ? 'checked' : ''}> on</label>
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p144">Transpose</label>
                    ${dx7EditorSelect(144, transposeLabels, Math.min(b[144], 48))}
                </div>
            </div>

            <div style="overflow-x: auto;">
                <table class="dx7-op-table">
                    <thead><tr><th style="text-align: left;">Operator</th>${opHeaders.join('')}</tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>

            <h3 style="margin: 15px 0 10px 0;">Pitch Envelope</h3>
            <div class="controls-grid">${pitchEG}</div>

            <h3 style="margin: 15px 0 10px 0;">LFO</h3>
            <div class="controls-grid">
                <div class="control-group">
                    <label class="control-label" for="dx7p137">Speed</label>
                    ${dx7EditorNumberInput(137, 99, b[137])}
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p138">Delay</label>
                    ${dx7EditorNumberInput(138, 99, b[138])}
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p139" title="Pitch modulation depth">Pitch Mod Depth</label>
                    ${dx7EditorNumberInput(139, 99, b[139])}
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p140" title="Amplitude modulation depth">Amp Mod Depth</label>
                    ${dx7EditorNumberInput(140, 99, b[140])}
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p142">Wave</label>
                    ${dx7EditorSelect(142, DX7_LFO_WAVES, Math.min(b[142], 5))}
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p141" title="Restart the LFO on each note-on">LFO Key Sync</label>
                    <label><input type="checkbox" id="dx7p141" class="dx7-p" data-off="141" ${b[141] ? 'checked' : ''}> on</label>
                </div>
                <div class="control-group">
                    <label class="control-label" for="dx7p143">Pitch Mod Sens (0-7)</label>
                    ${dx7EditorNumberInput(143, 7, b[143])}
                </div>
            </div>
        </div>
    `;
}

function onDX7EditorChange(e) {
    const t = e.target;
    if (!dx7EditorBytes) return;

    if (t.classList.contains('dx7-op-en')) {
        const bit = parseInt(t.dataset.bit);
        if (t.checked) {
            dx7EditorBytes[155] |= (1 << bit);
        } else {
            dx7EditorBytes[155] &= ~(1 << bit);
        }
    } else if (t.classList.contains('dx7-name')) {
        for (let i = 0; i < 10; i++) {
            const c = i < t.value.length ? t.value.charCodeAt(i) : 32;
            dx7EditorBytes[145 + i] = (c >= 32 && c < 127) ? c : 32;
        }
    } else if (t.classList.contains('dx7-p')) {
        const off = parseInt(t.dataset.off);
        let value;
        if (t.type === 'checkbox') {
            value = t.checked ? 1 : 0;
        } else if (t.tagName === 'SELECT') {
            value = parseInt(t.value);
        } else {
            value = Math.min(parseInt(t.max), Math.max(0, parseInt(t.value) || 0));
            t.value = value;
        }
        dx7EditorBytes[off] = value;
        if (off === 134) updateDX7CarrierHint();
    } else {
        return;
    }

    currentState[`osc${dx7EditorOsc}DX7Patch`] = voiceDataToHex(dx7EditorBytes);
    updateDX7FreqReadouts();
    updateDX7Display(dx7EditorOsc);
}

function closeDX7Editor() {
    const modal = document.getElementById('dx7EditorModal');
    if (modal) {
        modal.remove();
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

