// Deluge Synth Editor - Application
// Main application logic, initialization, randomization

// ============================================================================
// COLOR THEME SWITCHER
// ============================================================================

/**
 * Set color theme (orange, blue, green, magenta)
 */
function setTheme(theme) {
    const body = document.body;
    
    // Remove all theme classes
    body.classList.remove('theme-blue', 'theme-green', 'theme-magenta');
    
    // Add new theme class (orange is default, no class needed)
    if (theme !== 'orange') {
        body.classList.add(`theme-${theme}`);
    }
    
    // Update active button
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.theme-btn.${theme}`).classList.add('active');
    
    // Save to localStorage
    localStorage.setItem('colorTheme', theme);
}

/**
 * Initialize theme from localStorage
 */
function initializeTheme() {
    const savedTheme = localStorage.getItem('colorTheme') || 'orange';
    setTheme(savedTheme);
}

// Initialize theme on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTheme);
} else {
    initializeTheme();
}

// ============================================================================
// RANDOMIZATION
// ============================================================================

function randomizePreset() {
    if (!confirm('Randomize all parameters? This will create a random synth preset.')) {
        return;
    }

    // Helper function to get random value in range
    const randRange = (min, max) => Math.random() * (max - min) + min;
    const randInt = (min, max) => Math.floor(randRange(min, max + 1));
    const randChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // NOTE: General tab is NOT randomized - user keeps their poly/mode/unison settings

    // Oscillators (exclude 'wavetable' and 'sample' as they require file paths)
    const oscTypes = ['sine', 'triangle', 'square', 'analogSquare', 'saw', 'analogSaw'];
    currentState.osc1Type = randChoice(oscTypes);
    currentState.osc1Transpose = randInt(-24, 24).toString();
    currentState.osc2Type = randChoice(oscTypes);
    currentState.osc2Transpose = randInt(-24, 24).toString();
    currentState.osc2Sync = randChoice(['0', '1']);

    // Oscillator levels - ensure at least one is audible
    const osc1Level = randRange(-20, 50);
    const osc2Level = randRange(-20, 50);
    const noiseLevel = randRange(-50, -10);

    // If both oscs are quiet, boost one
    if (osc1Level < -10 && osc2Level < -10) {
        if (Math.random() > 0.5) {
            currentState.oscAVolume = uiToHex(randRange(0, 50), -50, 50);
        } else {
            currentState.oscBVolume = uiToHex(randRange(0, 50), -50, 50);
        }
    } else {
        currentState.oscAVolume = uiToHex(osc1Level, -50, 50);
        currentState.oscBVolume = uiToHex(osc2Level, -50, 50);
    }

    currentState.noiseVolume = uiToHex(noiseLevel, -50, 50);
    currentState.oscAPulseWidth = uiToHex(randRange(-30, 30), -50, 50);
    currentState.oscBPulseWidth = uiToHex(randRange(-30, 30), -50, 50);

    // Master
    currentState.volume = uiToHex(randRange(-10, 30), -50, 50);
    currentState.pan = uiToHex(randRange(-15, 15), -25, 25);
    currentState.portamento = uiToHex(randRange(-40, 10), -50, 50);

    // Envelopes - keep musical
    currentState.env1Attack = uiToHex(randRange(0, 30), 0, 50);
    currentState.env1Decay = uiToHex(randRange(5, 35), 0, 50);
    currentState.env1Sustain = uiToHex(randRange(20, 50), 0, 50);
    currentState.env1Release = uiToHex(randRange(5, 35), 0, 50);

    currentState.env2Attack = uiToHex(randRange(0, 35), 0, 50);
    currentState.env2Decay = uiToHex(randRange(5, 35), 0, 50);
    currentState.env2Sustain = uiToHex(randRange(-15, 15), -25, 25);
    currentState.env2Release = uiToHex(randRange(5, 35), 0, 50);

    currentState.env3Attack = uiToHex(randRange(0, 35), 0, 50);
    currentState.env3Decay = uiToHex(randRange(5, 35), 0, 50);
    currentState.env3Sustain = uiToHex(randRange(-15, 15), -25, 25);
    currentState.env3Release = uiToHex(randRange(5, 35), 0, 50);

    currentState.env4Attack = uiToHex(randRange(0, 35), 0, 50);
    currentState.env4Decay = uiToHex(randRange(5, 35), 0, 50);
    currentState.env4Sustain = uiToHex(randRange(-15, 15), -25, 25);
    currentState.env4Release = uiToHex(randRange(5, 35), 0, 50);

    // Filters
    currentState.lpfMode = randChoice(['12dB', '24dB', '24dBDrive', 'SVF']);
    currentState.lpfFrequency = uiToHex(randRange(10, 50), 0, 50);
    currentState.lpfResonance = uiToHex(randRange(-20, 40), -50, 50);
    currentState.lpfMorph = uiToHex(randRange(-20, 20), -50, 50);

    currentState.hpfMode = randChoice(['12dB', '24dB', 'HPLadder']);
    currentState.hpfFrequency = uiToHex(randRange(-30, 10), 0, 50);
    currentState.hpfResonance = uiToHex(randRange(-30, 20), -50, 50);
    currentState.hpfMorph = uiToHex(randRange(-20, 20), -50, 50);

    currentState.filterRoute = randChoice(['HPF2LPF', 'LPF2HPF', 'PARALLEL', 'H2L']);
    currentState.waveFold = uiToHex(randRange(-40, 10), -50, 50);

    // LFOs
    const lfoTypes = ['sine', 'triangle', 'square', 'saw', 'sampleAndHold'];
    currentState.lfo1Type = randChoice(lfoTypes);
    currentState.lfo1SyncLevel = randInt(0, 9).toString();
    currentState.lfo1Rate = uiToHex(randRange(0, 35), 0, 50);

    currentState.lfo2Type = randChoice(lfoTypes);
    currentState.lfo2SyncLevel = randInt(0, 9).toString();
    currentState.lfo2Rate = uiToHex(randRange(0, 35), 0, 50);

    // Effects
    const modFXTypes = ['none', 'flanger', 'chorus', 'phaser', 'StereoChorus', 'warble'];
    currentState.modFXType = randChoice(modFXTypes);
    if (currentState.modFXType !== 'none') {
        currentState.modFXRate = uiToHex(randRange(0, 35), 0, 50);
        currentState.modFXDepth = uiToHex(randRange(5, 40), 0, 50);
        currentState.modFXOffset = uiToHex(randRange(-20, 20), -50, 50);
        currentState.modFXFeedback = uiToHex(randRange(0, 30), 0, 50);
    }

    currentState.delayRate = uiToHex(randRange(-20, 30), 0, 50);
    currentState.delayFeedback = uiToHex(randRange(-20, 30), 0, 50);
    currentState.reverbAmount = uiToHex(randRange(-30, 20), 0, 50);

    // EQ
    currentState.bass = uiToHex(randRange(-15, 15), -25, 25);
    currentState.treble = uiToHex(randRange(-15, 15), -25, 25);

    // Distortion (keep subtle usually)
    currentState.sampleRateReduction = uiToHex(randRange(-40, 10), 0, 50);
    currentState.bitCrush = uiToHex(randRange(-40, 10), 0, 50);

    // FM parameters (randomize based on current mode setting)
    const currentMode = document.getElementById('mode')?.value || currentState.mode;
    if (currentMode === 'fm') {
        currentState.modulator1Amount = uiToHex(randRange(-10, 40), -50, 50);
        currentState.modulator1Feedback = uiToHex(randRange(-30, 20), -50, 50);
        currentState.modulator2Amount = uiToHex(randRange(-10, 40), -50, 50);
        currentState.modulator2Feedback = uiToHex(randRange(-30, 20), -50, 50);
        currentState.carrier1Feedback = uiToHex(randRange(-30, 20), -50, 50);
        currentState.carrier2Feedback = uiToHex(randRange(-30, 20), -50, 50);
    }

    // Random patch cables (1-4 cables)
    patchCables = [];
    const numCables = randInt(1, 4);
    const usedDestinations = new Set();

    const commonSources = ['lfo1', 'lfo2', 'envelope1', 'envelope2', 'velocity', 'note'];
    const commonDestinations = [
        'volume', 'pan', 'pitch', 'lpfFrequency', 'lpfResonance',
        'hpfFrequency', 'oscAVolume', 'oscBVolume'
    ];

    for (let i = 0; i < numCables; i++) {
        let dest;
        let attempts = 0;
        do {
            dest = randChoice(commonDestinations);
            attempts++;
        } while (usedDestinations.has(dest) && attempts < 20);

        if (!usedDestinations.has(dest)) {
            usedDestinations.add(dest);
            patchCables.push({
                source: randChoice(commonSources),
                destination: dest,
                amount: uiToHex(randRange(-30, 30), -50, 50)
            });
        }
    }

    // Update UI
    updateUIFromState();

    // Generate random name
    const prefixes = ['Random', 'Wild', 'Cosmic', 'Deep', 'Bright', 'Dark', 'Electric', 'Analog', 'Digital', 'Vintage'];
    const suffixes = ['Bass', 'Lead', 'Pad', 'Pluck', 'Arp', 'Keys', 'Bell', 'String', 'Synth', 'Texture'];
    document.getElementById('presetName').value = `${randChoice(prefixes)} ${randChoice(suffixes)} ${randInt(1, 99)}`;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeKnobs();
    renderPatchCables();

    // Initialize envelope canvases
    drawEnvelope('env1Canvas', 0, 25, 50, 10, 0, 50);
    drawEnvelope('env2Canvas', 25, 25, 0, 25, -25, 25);
    drawEnvelope('env3Canvas', 25, 25, 0, 25, -25, 25);
    drawEnvelope('env4Canvas', 25, 25, 0, 25, -25, 25);

    // Add change listeners to all inputs to update state
    const inputs = document.querySelectorAll('select, input[type="number"], input[type="text"]');
    inputs.forEach(input => {
        if (input.id && input.id !== 'presetName' && input.id !== 'xmlFileInput') {
            input.addEventListener('change', () => {
                currentState[input.id] = input.value;

                // Redraw envelopes if envelope parameter changed
                if (input.id.startsWith('env')) {
                    const envNum = input.id.charAt(3); // Get envelope number (1-4)
                    updateEnvelopeDisplay(envNum);
                }
            });
        }
    });

});

