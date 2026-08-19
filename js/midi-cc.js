// Deluge Synth Editor - MIDI CC Support
// Sends MIDI Control Change messages for parameters that support it

// ============================================================================
// DEFAULT MIDI CC MAPPINGS (from Deluge MIDIFollow.XML)
// ============================================================================

// Firmware MIDIFollow.XML parameter names -> this app's data-param ids, for
// the controls whose names differ (paramNameForFile in
// modulation/params/param.cpp vs the knob ids here). Keys must stay in the
// app's namespace or sendMIDICC/handleIncomingCC can't find the knob - a
// firmware-named key is silently dead in both directions.
const CC_PARAM_ALIASES = {
    oscAPhaseWidth: 'oscAPulseWidth',
    oscBPhaseWidth: 'oscBPulseWidth',
    modulator1Volume: 'modulator1Amount',
    modulator2Volume: 'modulator2Amount',
    bitcrushAmount: 'bitCrush',
    bassFreq: 'bassFrequency',
    trebleFreq: 'trebleFrequency',
    arpRate: 'arpeggiatorRate',
    arpGate: 'arpeggiatorGate',
    volumePostFX: 'volume' // no post-FX volume control; drive the volume knob
};

// Rename firmware-named keys to the app's names (see CC_PARAM_ALIASES).
function normalizeCCMappingNames(mappings) {
    const result = {};
    Object.keys(mappings).forEach(name => {
        result[CC_PARAM_ALIASES[name] || name] = mappings[name];
    });
    return result;
}

let ccMappings = {
    // Oscillator A
    oscAVolume: 21,
    oscAPitch: 12,
    oscAPulseWidth: 23,
    carrier1Feedback: 24,
    oscAWavetablePosition: 25,

    // Noise
    noiseVolume: 41,

    // Oscillator B
    oscBVolume: 26,
    oscBPitch: 13,
    oscBPulseWidth: 28,
    carrier2Feedback: 29,
    oscBWavetablePosition: 30,

    // FM Modulators
    modulator1Amount: 54,
    modulator1Pitch: 14,
    modulator1Feedback: 55,
    modulator2Amount: 56,
    modulator2Pitch: 15,
    modulator2Feedback: 57,

    // Master Controls
    volume: 7,  // firmware name: volumePostFX
    pitch: 3,
    pan: 10,
    portamento: 5,

    // Effects
    sampleRateReduction: 63,
    bitCrush: 62,
    waveFold: 19,
    stutterRate: 20, // ccToSoundParam[20] in midi_follow.cpp
    
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
    bassFrequency: 84,
    treble: 87,
    trebleFrequency: 85,

    // Arpeggiator
    arpeggiatorRate: 51,
    arpeggiatorGate: 50,
    
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

// Reverse map CC number -> parameter name
let ccNumberToParam = {};

// MIDI CC enabled state (default: off)
let midiCCEnabled = false;

// Suppress outgoing CC when updating UI from incoming CC to avoid feedback
let suppressMIDISend = false;

function buildReverseCCMap() {
    ccNumberToParam = {};
    Object.keys(ccMappings).forEach(param => {
        const cc = ccMappings[param];
        if (typeof cc === 'number' && cc !== 255 && cc >= 0) {
            ccNumberToParam[cc] = param;
        }
    });
}

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
    if (suppressMIDISend) return;
    if (!midiCCEnabled) return;
    // Prefer dedicated CC output if available; fall back to main output
    const out = (typeof delugeCCOutput !== 'undefined' && delugeCCOutput) ? delugeCCOutput : delugeOutput;
    if (!out) return;
    
    const ccNumber = ccMappings[paramName];
    if (ccNumber === undefined || ccNumber === 255) return; // 255 means disabled
    
    // Convert UI value to MIDI CC value (0-127)
    const normalized = (uiValue - min) / (max - min);
    const clamped = Math.max(0, Math.min(1, normalized));
    const ccValue = Math.round(clamped * 127);
    
    try {
        out.send([0xB0, ccNumber, ccValue]);
        console.log(`MIDI CC OUT: ${paramName} -> CC${ccNumber} = ${ccValue} (via ${out.name})`);
    } catch (error) {
        console.error('Failed to send MIDI CC:', error);
    }
}

/**
 * Send MIDI CC for all parameters that have CC mappings
 * Used after patch morphing to update all CC values at once
 */
function sendAllMIDICCs() {
    console.log('sendAllMIDICCs called. midiCCEnabled:', midiCCEnabled, 'delugeOutput:', !!delugeOutput);
    
    if (!midiCCEnabled) {
        console.log('MIDI CC disabled, skipping send');
        return;
    }
    if (!delugeOutput) {
        console.log('No Deluge output, skipping send');
        return;
    }
    
    const knobs = document.querySelectorAll('[data-param]');
    console.log('Found', knobs.length, 'knobs with data-param');
    
    let sentCount = 0;
    knobs.forEach(knob => {
        const paramName = knob.dataset.param;
        const ccNumber = ccMappings[paramName];
        if (ccNumber === undefined || ccNumber === 255) return;
        
        const hexValue = currentState[paramName];
        if (!hexValue) return;
        
        const min = parseFloat(knob.dataset.min) || -50;
        const max = parseFloat(knob.dataset.max) || 50;
        const uiValue = hexToUI(hexValue, min, max);
        
        sendMIDICC(paramName, uiValue, min, max);
        sentCount++;
    });
    
    console.log(`Sent MIDI CC for ${sentCount} parameters after patch morph`);
}

/**
 * Handle incoming CC from Deluge and update UI/state
 * @param {number} ccNumber - MIDI CC number (0-127)
 * @param {number} ccValue - MIDI value (0-127)
 */
function handleIncomingCC(ccNumber, ccValue) {
    const paramName = ccNumberToParam[ccNumber];
    if (!paramName) return; // Not mapped
    
    // Find the UI control to get min/max ranges
    const knob = document.querySelector(`[data-param="${paramName}"]`);
    const min = knob ? parseFloat(knob.dataset.min) : -50;
    const max = knob ? parseFloat(knob.dataset.max) : 50;
    
    // Convert CC (0-127) to UI value
    const uiValue = min + (ccValue / 127) * (max - min);
    
    // Update UI display
    if (knob) {
        updateKnobDisplay(knob, uiValue, min, max);
    }
    
    // Update state without echoing CC back
    suppressMIDISend = true;
    try {
        updateParameter(paramName, uiValue, min, max);
    } finally {
        suppressMIDISend = false;
    }
    
    console.log(`MIDI CC IN: CC${ccNumber} -> ${paramName} = ${ccValue} (ui=${uiValue.toFixed(2)})`);
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
        
        // Firmware PR #4526 (June 2026) renamed the tag from <defaultCCMappings>
        // to <cc_mappings> (midi_follow.cpp: MIDI_DEFAULTS_CC_TAG); accept both
        const mappings = xmlDoc.querySelector('cc_mappings') ||
                         xmlDoc.querySelector('defaultCCMappings');
        if (!mappings) {
            throw new Error('Invalid MIDIFollow.XML format');
        }
        
        // Clear existing mappings (start fresh from XML)
        ccMappings = {};
        
        // Extract all mappings from XML, translating firmware names to ours
        const children = mappings.children;
        for (let i = 0; i < children.length; i++) {
            const paramName = CC_PARAM_ALIASES[children[i].tagName] || children[i].tagName;
            const ccNumber = parseInt(children[i].textContent, 10);

            // Only add if it's a valid CC number (not 255 which means disabled)
            if (!isNaN(ccNumber) && ccNumber !== 255) {
                ccMappings[paramName] = ccNumber;
            }
        }
        
        // Rebuild reverse map and update labels
        buildReverseCCMap();
        console.log('Loaded MIDI CC mappings from MIDIFollow.XML:', Object.keys(ccMappings).length, 'parameters');
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
        // The firmware keeps it at SETTINGS/MIDIFollow.XML (midi_follow.cpp: MIDI_FOLLOW_XML);
        // fall back to the root for cards written by older firmware
        let data;
        try {
            data = await readFile('/SETTINGS/MIDIFollow.XML');
        } catch (settingsError) {
            console.warn('No /SETTINGS/MIDIFollow.XML, trying card root:', settingsError);
            data = await readFile('/MIDIFollow.XML');
        }
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
        showNotification('✗ Could not load MIDIFollow.XML from /SETTINGS/ or root. Using defaults.', true);
    }
}

// ============================================================================
// MIDI FOLLOW HELP MODAL
// ============================================================================

function openMIDIFollowHelp() {
    document.getElementById('midiFollowHelpModal').classList.add('show');
}

function closeMIDIFollowHelp() {
    document.getElementById('midiFollowHelpModal').classList.remove('show');
}

/**
 * Mark each control that has a live MIDI CC mapping with a small green "cc"
 * badge (no CC numbers - those were tried as superscript badges once and were
 * visual noise; the number lives in the badge's hover tooltip instead).
 */
function updateLabelsForCCMappings() {
    document.querySelectorAll('.control-label sup, .control-label .cc-badge')
        .forEach(el => el.remove());
    document.querySelectorAll('[data-param]').forEach(el => {
        const cc = ccMappings[el.dataset.param];
        if (cc === undefined || cc === 255) return;
        const label = el.closest('.control-group')?.querySelector('.control-label');
        if (!label || label.querySelector('.cc-badge')) return;
        const badge = document.createElement('span');
        badge.className = 'cc-badge';
        badge.textContent = 'cc';
        badge.title = 'Live-tweakable over MIDI Follow (CC ' + cc + ')';
        label.appendChild(badge);
    });
}

/**
 * Load MIDI CC mappings from localStorage or use defaults
 */
function initializeCCMappings() {
    const saved = localStorage.getItem('delugeCCMappings');
    if (saved) {
        try {
            // normalize in case the state was saved before the firmware-name fix
            ccMappings = normalizeCCMappingNames(JSON.parse(saved));
            console.log('Loaded MIDI CC mappings from localStorage');
        } catch (error) {
            console.error('Failed to load saved CC mappings:', error);
        }
    }
    
    // Build reverse map and update labels
    buildReverseCCMap();
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

