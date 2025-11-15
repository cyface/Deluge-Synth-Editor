// Deluge Synth Editor - MIDI CC Support
// Sends MIDI Control Change messages for parameters that support it

// ============================================================================
// DEFAULT MIDI CC MAPPINGS (from Deluge MIDIFollow.XML)
// ============================================================================

let ccMappings = {
    // Oscillator A
    oscAVolume: 21,
    oscAPitch: 12,
    oscAPhaseWidth: 23,
    carrier1Feedback: 24,
    oscAWavetablePosition: 25,
    
    // Noise
    noiseVolume: 41,
    
    // Oscillator B
    oscBVolume: 26,
    oscBPitch: 13,
    oscBPhaseWidth: 28,
    carrier2Feedback: 29,
    oscBWavetablePosition: 30,
    
    // FM Modulators
    modulator1Volume: 54,
    modulator1Pitch: 14,
    modulator1Feedback: 55,
    modulator2Volume: 56,
    modulator2Pitch: 15,
    modulator2Feedback: 57,
    
    // Master Controls
    volume: 7,  // Master volume (also volumePostFX)
    volumePostFX: 7,
    pitch: 3,
    pan: 10,
    portamento: 5,
    
    // Effects
    sampleRateReduction: 63,
    bitcrushAmount: 62,
    waveFold: 19,
    stutterRate: 255, // Special: not used (255 means disabled)
    
    // Envelope 1
    env1Attack: 73,
    env1Decay: 75,
    env1Sustain: 76,
    env1Release: 72,
    
    // Filter (LPF)
    lpfMorph: 70,
    lpfResonance: 71,
    lpfFrequency: 74,
    
    // Envelope 2
    env2Attack: 77,
    env2Decay: 78,
    env2Sustain: 79,
    env2Release: 80,
    
    // Filter (HPF)
    hpfMorph: 83,
    hpfResonance: 82,
    hpfFrequency: 81,
    
    // Compressor
    sidechainCompressorVolume: 61,
    compressorShape: 60,
    
    // EQ
    bass: 86,
    bassFreq: 84,
    treble: 87,
    trebleFreq: 85,
    
    // Arpeggiator
    arpRate: 51,
    arpGate: 50,
    
    // LFOs
    lfo1Rate: 58,
    lfo2Rate: 59,
    
    // ModFX
    modFXOffset: 18,
    modFXFeedback: 17,
    modFXDepth: 93,
    modFXRate: 16,
    
    // Reverb & Delay
    reverbAmount: 91,
    delayRate: 53,
    delayFeedback: 52
};

// MIDI CC enabled state (default: off)
let midiCCEnabled = false;

// ============================================================================
// MIDI CC SENDING
// ============================================================================

/**
 * Send MIDI CC message for a parameter
 * @param {string} paramName - Parameter name (e.g., 'oscAVolume')
 * @param {number} uiValue - UI value (0-50, -50 to 50, etc.)
 * @param {number} min - Minimum UI value
 * @param {number} max - Maximum UI value
 */
function sendMIDICC(paramName, uiValue, min, max) {
    if (!midiCCEnabled) return;
    if (!delugeOutput) return;
    
    const ccNumber = ccMappings[paramName];
    if (ccNumber === undefined || ccNumber === 255) return; // 255 means disabled
    
    // Convert UI value to MIDI CC value (0-127)
    // Normalize to 0-1 range
    const normalized = (uiValue - min) / (max - min);
    // Clamp to 0-1
    const clamped = Math.max(0, Math.min(1, normalized));
    // Convert to MIDI CC (0-127)
    const ccValue = Math.round(clamped * 127);
    
    // Send MIDI CC message: [0xB0, CC# (0-119), Value (0-127)]
    // Channel 1 (0xB0 = Control Change on channel 1)
    try {
        delugeOutput.send([0xB0, ccNumber, ccValue]);
        console.log(`MIDI CC: ${paramName} -> CC${ccNumber} = ${ccValue}`);
    } catch (error) {
        console.error('Failed to send MIDI CC:', error);
    }
}

/**
 * Toggle MIDI CC sending on/off
 */
function toggleMIDICC() {
    const toggle = document.getElementById('midiCCToggle');
    if (toggle) {
        midiCCEnabled = toggle.checked;
    } else {
        midiCCEnabled = !midiCCEnabled;
    }
    
    const indicator = document.getElementById('midiCCIndicator');
    if (indicator) {
        indicator.textContent = midiCCEnabled ? 'MIDI CC: ON' : 'MIDI CC: OFF';
        indicator.style.color = midiCCEnabled ? '#4CAF50' : '#888';
    }
    
    showNotification(midiCCEnabled ? '✓ MIDI CC enabled' : 'MIDI CC disabled');
    saveMIDICCState();
}

// ============================================================================
// LOAD MIDI FOLLOW XML
// ============================================================================

/**
 * Load MIDI CC mappings from Deluge MIDIFollow.XML file
 * @param {string} xmlString - XML content from MIDIFollow.XML
 */
function loadMIDIFollowXML(xmlString) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
        
        const mappings = xmlDoc.querySelector('defaultCCMappings');
        if (!mappings) {
            throw new Error('Invalid MIDIFollow.XML format');
        }
        
        // Clear existing mappings (start fresh from XML)
        ccMappings = {};
        
        // Extract all mappings from XML
        const children = mappings.children;
        for (let i = 0; i < children.length; i++) {
            const paramName = children[i].tagName;
            const ccNumber = parseInt(children[i].textContent, 10);
            
            // Only add if it's a valid CC number (not 255 which means disabled)
            if (!isNaN(ccNumber) && ccNumber !== 255) {
                ccMappings[paramName] = ccNumber;
                
                // Special mappings: create aliases for parameters that have different names in our UI
                // MIDIFollow uses "volumePostFX" but our UI uses "volume"
                if (paramName === 'volumePostFX') {
                    ccMappings['volume'] = ccNumber;
                }
            }
        }
        
        console.log('Loaded MIDI CC mappings from MIDIFollow.XML:', Object.keys(ccMappings).length, 'parameters');
        
        // Update UI labels to reflect which parameters have CC support
        updateLabelsForCCMappings();
        
        showNotification('✓ MIDI CC mappings loaded - ' + Object.keys(ccMappings).length + ' parameters');
        return true;
    } catch (error) {
        console.error('Failed to load MIDIFollow.XML:', error);
        showNotification('✗ Failed to load MIDI CC mappings', true);
        return false;
    }
}

/**
 * Load MIDI FOLLOW XML from Deluge SD card
 */
async function loadMIDIFollowFromDeluge() {
    if (!delugeOutput) {
        showNotification('✗ Not connected to Deluge', true);
        return;
    }
    
    try {
        showCommIndicator();
        // Read file from root of SD card
        const data = await readFile('/MIDIFollow.XML');
        // Convert binary data to string
        const xmlString = new TextDecoder().decode(data);
        hideCommIndicator();
        
        if (loadMIDIFollowXML(xmlString)) {
            // Save to localStorage for persistence
            saveMIDICCState();
        }
    } catch (error) {
        hideCommIndicator();
        console.error('Failed to load MIDIFollow.XML from Deluge:', error);
        showNotification('✗ Could not load MIDIFollow.XML from root directory. Using defaults.', true);
    }
}

/**
 * Update all control labels to show CC numbers for parameters that support MIDI CC
 */
function updateLabelsForCCMappings() {
    // Find all knobs with data-param attributes
    const knobs = document.querySelectorAll('[data-param]');
    
    knobs.forEach(knob => {
        const paramName = knob.dataset.param;
        const ccNumber = ccMappings[paramName];
        
        // Find the associated label
        const controlGroup = knob.closest('.control-group');
        if (!controlGroup) return;
        
        const label = controlGroup.querySelector('.control-label');
        if (!label) return;
        
        // Get base label text (remove any existing superscript)
        let baseText = label.innerHTML;
        // Remove existing superscript tags
        baseText = baseText.replace(/<sup>.*?<\/sup>/g, '');
        baseText = baseText.trim();
        
        // If this parameter has a CC mapping, add the CC number as superscript
        if (ccNumber !== undefined && ccNumber !== 255) {
            label.innerHTML = baseText + '<sup>' + ccNumber + '</sup>';
        } else {
            label.innerHTML = baseText;
        }
    });
    
    console.log('Updated labels for CC mappings');
}

/**
 * Load MIDI CC mappings from localStorage or use defaults
 */
function initializeCCMappings() {
    const saved = localStorage.getItem('delugeCCMappings');
    if (saved) {
        try {
            ccMappings = JSON.parse(saved);
            console.log('Loaded MIDI CC mappings from localStorage');
        } catch (error) {
            console.error('Failed to load saved CC mappings:', error);
        }
    }
    
    // Update labels after loading mappings
    if (typeof document !== 'undefined' && document.readyState === 'complete') {
        updateLabelsForCCMappings();
    }
    
    // Load enabled state
    const enabled = localStorage.getItem('midiCCEnabled');
    if (enabled === 'true') {
        midiCCEnabled = true;
        const toggle = document.getElementById('midiCCToggle');
        if (toggle) {
            toggle.checked = true;
        }
        const indicator = document.getElementById('midiCCIndicator');
        if (indicator) {
            indicator.textContent = 'MIDI CC: ON';
            indicator.style.color = '#4CAF50';
        }
    }
}

/**
 * Save MIDI CC enabled state
 */
function saveMIDICCState() {
    localStorage.setItem('midiCCEnabled', midiCCEnabled.toString());
    localStorage.setItem('delugeCCMappings', JSON.stringify(ccMappings));
}

// Auto-initialize on load
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeCCMappings();
        // Update labels once DOM is ready
        setTimeout(() => {
            updateLabelsForCCMappings();
        }, 100);
    });
    
    // Also update labels after window fully loads
    window.addEventListener('load', () => {
        setTimeout(() => {
            updateLabelsForCCMappings();
        }, 100);
    });
}

