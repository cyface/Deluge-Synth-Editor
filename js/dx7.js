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
    if (!container) return;
    
    // Show DX7 container
    container.style.display = 'block';
    
    // Update display if we have DX7 data
    updateDX7Display(oscNum);
    
    // Setup event listeners
    setupDX7EventListeners(oscNum);
}

/**
 * Setup event listeners for DX7 controls
 */
function setupDX7EventListeners(oscNum) {
    // Load local .syx file
    const fileInput = document.getElementById(`osc${oscNum}DX7FileInput`);
    if (fileInput) {
        fileInput.addEventListener('change', (e) => loadDX7SysexFile(e, oscNum));
    }
    
    // Browse Deluge SD card
    const browseBtn = document.getElementById(`osc${oscNum}DX7BrowseBtn`);
    if (browseBtn) {
        browseBtn.addEventListener('click', () => browseDX7FromDeluge(oscNum));
    }
    
    // Engine mode dropdown
    const engineSelect = document.getElementById(`osc${oscNum}DX7EngineMode`);
    if (engineSelect) {
        engineSelect.addEventListener('change', (e) => {
            currentState[`osc${oscNum}DX7EngineMode`] = e.target.value;
        });
    }
    
    // Random detune slider
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
 * Load DX7 .syx file from local filesystem
 */
async function loadDX7SysexFile(event, oscNum) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        const buffer = await file.arrayBuffer();
        const parsed = parseDX7Sysex(buffer);
        
        if (parsed.isCartridge) {
            // Show patch selector for cartridge
            showDX7CartridgeSelector(parsed.voiceData, oscNum);
        } else {
            // Load single voice directly
            loadDX7Voice(parsed.voiceData, oscNum);
        }
        
        showNotification(`✓ Loaded DX7 patch: ${file.name}`);
    } catch (error) {
        console.error('Error loading DX7 file:', error);
        showNotification(`✗ Error loading DX7 file: ${error.message}`, true);
    }
}

/**
 * Show cartridge patch selector
 */
function showDX7CartridgeSelector(cartridgeData, oscNum) {
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
            <h2>Select DX7 Patch</h2>
            <div style="max-height: 400px; overflow-y: auto; margin: 20px 0;">
                ${patches.map(p => `
                    <div class="dx7-patch-item" data-index="${p.index}" style="padding: 10px; cursor: pointer; border-bottom: 1px solid #333;">
                        <strong>${p.index + 1}.</strong> ${p.name}
                    </div>
                `).join('')}
            </div>
            <button onclick="closeDX7CartridgeSelector()">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(dialog);
    dialog.style.display = 'flex';
    
    // Add click handlers
    dialog.querySelectorAll('.dx7-patch-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            const packedVoice = cartridgeData.slice(index * 128, (index + 1) * 128);
            const unpackedVoice = unpackDX7Voice(packedVoice);
            loadDX7Voice(unpackedVoice, oscNum);
            document.body.removeChild(dialog);
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
 */
function loadDX7Voice(unpackedVoice, oscNum) {
    // Store as hex string
    currentState[`osc${oscNum}DX7Patch`] = voiceDataToHex(unpackedVoice);
    
    // Extract and display info
    updateDX7Display(oscNum);
    
    console.log(`Loaded DX7 patch to OSC${oscNum}`);
}

/**
 * Update DX7 display with current patch info
 */
function updateDX7Display(oscNum) {
    const patchHex = currentState[`osc${oscNum}DX7Patch`];
    
    if (!patchHex || patchHex.length !== 312) { // 156 bytes * 2 hex chars
        document.getElementById(`osc${oscNum}DX7Info`).style.display = 'none';
        return;
    }
    
    const voiceData = hexToVoiceData(patchHex);
    
    // Extract info
    const name = extractDX7PatchName(voiceData, 0, false);
    const algorithm = extractDX7Algorithm(voiceData);
    const feedback = extractDX7Feedback(voiceData);
    const oscSync = extractDX7OscSync(voiceData);
    
    // Update UI
    document.getElementById(`osc${oscNum}DX7PatchName`).textContent = name;
    document.getElementById(`osc${oscNum}DX7Algorithm`).textContent = algorithm;
    document.getElementById(`osc${oscNum}DX7Feedback`).textContent = feedback;
    document.getElementById(`osc${oscNum}DX7OscSync`).textContent = oscSync ? 'ON' : 'OFF';
    document.getElementById(`osc${oscNum}DX7Info`).style.display = 'block';
    
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
 * Browse DX7 patches from Deluge SD card
 */
async function browseDX7FromDeluge(oscNum) {
    if (!delugeOutput) {
        showNotification('✗ Not connected to Deluge', true);
        return;
    }
    
    try {
        // Browse /DX7/ folder
        const entries = await listDirectory('/DX7/');
        const sysexFiles = entries.filter(e => 
            !e.dir && e.name.toLowerCase().endsWith('.syx')
        );
        
        if (sysexFiles.length === 0) {
            showNotification('No .syx files found in /DX7/ folder', true);
            return;
        }
        
        // Show file browser
        showDX7FileBrowser(sysexFiles, oscNum);
        
    } catch (error) {
        console.error('Error browsing DX7 patches:', error);
        showNotification(`✗ Error: ${error.message}`, true);
    }
}

/**
 * Show DX7 file browser dialog
 */
function showDX7FileBrowser(files, oscNum) {
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <h2>DX7 Patches on Deluge</h2>
            <div style="max-height: 400px; overflow-y: auto; margin: 20px 0;">
                ${files.map(f => `
                    <div class="dx7-file-item" data-name="${f.name}" style="padding: 10px; cursor: pointer; border-bottom: 1px solid #333;">
                        📄 ${f.name}
                    </div>
                `).join('')}
            </div>
            <button onclick="closeDX7FileBrowser()">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(dialog);
    dialog.style.display = 'flex';
    
    // Add click handlers
    dialog.querySelectorAll('.dx7-file-item').forEach(item => {
        item.addEventListener('click', async () => {
            const filename = item.dataset.name;
            await loadDX7FromDeluge(filename, oscNum);
            document.body.removeChild(dialog);
        });
    });
    
    window.currentDX7FileBrowser = dialog;
}

/**
 * Close DX7 file browser
 */
function closeDX7FileBrowser() {
    if (window.currentDX7FileBrowser) {
        document.body.removeChild(window.currentDX7FileBrowser);
        window.currentDX7FileBrowser = null;
    }
}

/**
 * Load DX7 patch from Deluge SD card
 */
async function loadDX7FromDeluge(filename, oscNum) {
    try {
        showNotification('Loading DX7 patch from Deluge...');
        
        const data = await readFile(`/DX7/${filename}`);
        const parsed = parseDX7Sysex(data.buffer);
        
        if (parsed.isCartridge) {
            showDX7CartridgeSelector(parsed.voiceData, oscNum);
        } else {
            loadDX7Voice(parsed.voiceData, oscNum);
        }
        
        showNotification(`✓ Loaded DX7 patch: ${filename}`);
    } catch (error) {
        console.error('Error loading DX7 from Deluge:', error);
        showNotification(`✗ Error: ${error.message}`, true);
    }
}

/**
 * Clear DX7 patch
 */
function clearDX7Patch(oscNum) {
    currentState[`osc${oscNum}DX7Patch`] = '';
    currentState[`osc${oscNum}DX7EngineMode`] = '0';
    currentState[`osc${oscNum}DX7RandomDetune`] = '0';
    updateDX7Display(oscNum);
    showNotification(`✓ Cleared DX7 patch from OSC${oscNum}`);
}

