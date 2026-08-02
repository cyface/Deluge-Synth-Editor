// Deluge Synth Editor - PatchMorph
// Intelligent patch randomization with safety limits and morphing controls

// ============================================================================
// CONFIGURABLE LIMITS (easy to tweak after testing)
// ============================================================================

const MORPH_LIMITS = {
    // Oscillator limits
    OSC_VOLUME_MIN: -50,
    OSC_VOLUME_MAX: 40,  // Prevent clipping
    OSC_TRANSPOSE_MIN: -24,
    OSC_TRANSPOSE_MAX: 24,
    
    // Filter limits
    FILTER_FREQ_MIN: -50,
    FILTER_FREQ_MAX: 50,
    FILTER_RES_MIN: 0,
    FILTER_RES_MAX: 50,
    
    // Envelope limits
    ENV_SHORT_MIN: 0,
    ENV_SHORT_MAX: 20,
    ENV_LONG_MIN: 30,
    ENV_LONG_MAX: 80,  // Prevent extremely long tails
    
    // FX limits
    FX_LEVEL_MIN: 0,
    FX_LEVEL_MAX: 80,  // Prevent ear damage from extreme feedback
    DELAY_RATE_MAX: 50,  // Maximum delay rate (can go full range)
    DELAY_FEEDBACK_MAX: 25,  // Critical safety limit (keep feedback low)
    
    // Modulation limits (patch cable amounts)
    MOD_AMOUNT_MIN: 3,   // Subtle modulation
    MOD_AMOUNT_MAX: 30,  // Keep modulation tasteful (rarely hit 50)
    MOD_CABLES_MIN: 2,
    MOD_CABLES_MAX: 8
};

// ============================================================================
// MORPH SETTINGS (stored in UI)
// ============================================================================

const morphSettings = {
    oscillators: {
        randomizePitch: false,
        amount: 0,  // 0-100
        includeStandard: true,
        includeWavetable: false,
        includeSample: false,
        sampleFolder: '/SAMPLES/'
    },
    filters: {
        amount: 0  // 0-100
    },
    envelopes: {
        length: 0  // 0=short, 100=long
    },
    fx: {
        amount: 0  // 0=less, 100=more
    },
    modulation: {
        depth: 0  // 0=subtle, 100=extreme
    }
};

// ============================================================================
// UPDATE SETTINGS FROM UI
// ============================================================================

function updateMorphSettings() {
    // Read oscillator settings
    const pitchCheckbox = document.getElementById('morphOscPitch');
    if (pitchCheckbox) {
        morphSettings.oscillators.randomizePitch = pitchCheckbox.checked;
    }
    
    const standardCheckbox = document.getElementById('morphOscStandard');
    if (standardCheckbox) {
        morphSettings.oscillators.includeStandard = standardCheckbox.checked;
    }
    
    const wavetableCheckbox = document.getElementById('morphOscWavetable');
    if (wavetableCheckbox) {
        morphSettings.oscillators.includeWavetable = wavetableCheckbox.checked;
    }
    
    const sampleCheckbox = document.getElementById('morphOscSample');
    if (sampleCheckbox) {
        morphSettings.oscillators.includeSample = sampleCheckbox.checked;
    }
    
    const oscAmountSlider = document.getElementById('morphOscAmount');
    if (oscAmountSlider) {
        morphSettings.oscillators.amount = parseInt(oscAmountSlider.value);
    }
    
    const sampleFolderInput = document.getElementById('morphSampleFolder');
    if (sampleFolderInput && sampleFolderInput.value) {
        morphSettings.oscillators.sampleFolder = sampleFolderInput.value;
    }
    
    // Read other settings
    const filterAmountSlider = document.getElementById('morphFilterAmount');
    if (filterAmountSlider) {
        morphSettings.filters.amount = parseInt(filterAmountSlider.value);
    }
    
    const envLengthSlider = document.getElementById('morphEnvLength');
    if (envLengthSlider) {
        morphSettings.envelopes.length = parseInt(envLengthSlider.value);
    }
    
    const fxAmountSlider = document.getElementById('morphFXAmount');
    if (fxAmountSlider) {
        morphSettings.fx.amount = parseInt(fxAmountSlider.value);
    }
    
    const modDepthSlider = document.getElementById('morphModDepth');
    if (modDepthSlider) {
        morphSettings.modulation.depth = parseInt(modDepthSlider.value);
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function randRange(min, max) {
    return Math.random() * (max - min) + min;
}

function randInt(min, max) {
    return Math.floor(randRange(min, max + 1));
}

function randChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================================
// OSCILLATOR MORPHING
// ============================================================================

async function morphOscillators() {
    const amount = morphSettings.oscillators.amount / 100;
    
    // Skip if amount is 0
    if (amount === 0) return;
    
    // Randomize synth mode (subtractive, fm, ringmod)
    const modes = ['subtractive', 'subtractive', 'subtractive', 'fm', 'ringmod']; // Favor subtractive
    currentState.mode = randChoice(modes);
    
    // Randomize unison (50% chance)
    if (Math.random() < 0.5) {
        currentState.unisonNum = randInt(2, 4).toString(); // 2-4 voices
        currentState.unisonDetune = randInt(5, 20).toString(); // 5-20 detune
        currentState.unisonSpread = Math.random() < 0.3 ? '1' : '0'; // 30% chance of stereo spread
    } else {
        currentState.unisonNum = '1';
        currentState.unisonDetune = '8';
        currentState.unisonSpread = '0';
    }
    
    // If FM mode, set FM parameters
    if (currentState.mode === 'fm') {
        currentState.modulator1Amount = uiToHex(randRange(10, 40), -50, 50);
        currentState.modulator1Feedback = uiToHex(randRange(-10, 10), -50, 50);
        currentState.modulator2Amount = uiToHex(randRange(0, 30), -50, 50);
        currentState.modulator2Feedback = uiToHex(randRange(-10, 10), -50, 50);
        currentState.carrier1Feedback = uiToHex(randRange(-5, 15), -50, 50);
        currentState.carrier2Feedback = uiToHex(randRange(-5, 10), -50, 50);
    } else {
        // Reset FM parameters for non-FM modes
        currentState.modulator1Amount = '0x80000000';
        currentState.modulator1Feedback = '0x80000000';
        currentState.modulator2Amount = '0x80000000';
        currentState.modulator2Feedback = '0x80000000';
        currentState.carrier1Feedback = '0x80000000';
        currentState.carrier2Feedback = '0x80000000';
    }
    
    // Build available oscillator types based on checkboxes
    const availableTypes = [];
    
    if (morphSettings.oscillators.includeStandard) {
        availableTypes.push(...['sine', 'triangle', 'square', 'analogSquare', 'saw', 'analogSaw']);
    }
    if (morphSettings.oscillators.includeWavetable) {
        availableTypes.push('wavetable');
    }
    if (morphSettings.oscillators.includeSample) {
        availableTypes.push('sample');
    }
    
    // Need at least one type selected
    if (availableTypes.length === 0) {
        console.warn('No oscillator types selected for morphing');
        return;
    }
    
    const minVol = MORPH_LIMITS.OSC_VOLUME_MIN;
    const maxVol = MORPH_LIMITS.OSC_VOLUME_MAX;
    
    // OSC1
    currentState.osc1Type = randChoice(availableTypes);
    
    if (morphSettings.oscillators.randomizePitch) {
        // Full pitch randomization
        const transposeRange = Math.floor(amount * 24);
        currentState.osc1Transpose = randInt(-transposeRange, transposeRange).toString();
        currentState.osc1Cents = randInt(-50, 50).toString();
    } else {
        // Constrained to octave jumps (0, +12, -12) with subtle detuning
        currentState.osc1Transpose = randChoice(['0', '12', '-12']);
        currentState.osc1Cents = randInt(-6, 6).toString();
    }
    
    // Handle sample/wavetable file selection
    if (currentState.osc1Type === 'wavetable' || currentState.osc1Type === 'sample') {
        await selectRandomFile(1, morphSettings.oscillators.sampleFolder);
    } else {
        currentState.osc1File = '';
    }
    
    // Ensure at least one oscillator is at max volume for consistent loudness
    // 80% chance OSC1 is max (primary oscillator), 20% chance OSC2 is max
    if (Math.random() < 0.8) {
        // OSC1 at max, OSC2 random
        currentState.oscAVolume = uiToHex(maxVol, minVol, maxVol);
        currentState.oscBVolume = uiToHex(randRange(minVol, maxVol), minVol, maxVol);
    } else {
        // OSC2 at max, OSC1 random
        currentState.oscAVolume = uiToHex(randRange(minVol, maxVol), minVol, maxVol);
        currentState.oscBVolume = uiToHex(maxVol, minVol, maxVol);
    }
    
    // OSC2 - If OSC1 is wavetable/sample, limit OSC2 to standard types only (CPU performance)
    let osc2Types = availableTypes;
    if (currentState.osc1Type === 'wavetable' || currentState.osc1Type === 'sample') {
        // OSC1 is already wavetable/sample, so OSC2 must be standard
        osc2Types = ['sine', 'triangle', 'square', 'analogSquare', 'saw', 'analogSaw'];
    }
    
    currentState.osc2Type = randChoice(osc2Types);
    
    if (morphSettings.oscillators.randomizePitch) {
        // Full pitch randomization
        const transposeRange = Math.floor(amount * 24);
        currentState.osc2Transpose = randInt(-transposeRange, transposeRange).toString();
        currentState.osc2Cents = randInt(-50, 50).toString();
    } else {
        // Constrained to octave jumps (0, +12, -12) with subtle detuning
        currentState.osc2Transpose = randChoice(['0', '12', '-12']);
        currentState.osc2Cents = randInt(-6, 6).toString();
    }
    
    if (currentState.osc2Type === 'wavetable' || currentState.osc2Type === 'sample') {
        await selectRandomFile(2, morphSettings.oscillators.sampleFolder);
    } else {
        currentState.osc2File = '';
    }
    
    currentState.osc2Sync = randChoice(['0', '1']);
}

// ============================================================================
// FILTER MORPHING
// ============================================================================

function morphFilters() {
    const amount = morphSettings.filters.amount / 100;
    
    // Skip if amount is 0
    if (amount === 0) return;
    
    // LPF - frequency range is 0 (closed) to 50 (wide open)
    currentState.lpfFrequency = uiToHex(randRange(10, 50), 0, 50);
    currentState.lpfResonance = uiToHex(randRange(0, 50 * amount), 0, 50);
    
    // HPF (more subtle) - frequency range is 0 (closed) to 50 (wide open)
    if (Math.random() < amount) {
        currentState.hpfFrequency = uiToHex(randRange(0, 20), 0, 50);
        currentState.hpfResonance = uiToHex(randRange(0, 30 * amount), 0, 50);
    } else {
        currentState.hpfFrequency = uiToHex(0, 0, 50);  // Closed
        currentState.hpfResonance = uiToHex(0, 0, 50);
    }
}

// ============================================================================
// ENVELOPE MORPHING
// ============================================================================

function morphEnvelopes() {
    const length = morphSettings.envelopes.length / 100; // 0=short, 1=long
    
    // DIRECTLY SET envelope times based on slider (don't morph from current values)
    // Interpolate between short and long settings
    // At 0: short/punchy (0-20), At 100: long/pad (30-80)
    const attackMin = MORPH_LIMITS.ENV_SHORT_MIN + (length * (MORPH_LIMITS.ENV_LONG_MIN - MORPH_LIMITS.ENV_SHORT_MIN));
    const attackMax = MORPH_LIMITS.ENV_SHORT_MAX + (length * (MORPH_LIMITS.ENV_LONG_MAX - MORPH_LIMITS.ENV_SHORT_MAX));
    const decayMin = attackMin;
    const decayMax = attackMax;
    const releaseMin = attackMin;
    const releaseMax = attackMax;
    
    // ENV1 (amplitude) - slider directly sets the time range
    currentState.env1Attack = uiToHex(randRange(attackMin, attackMax), 0, 50);
    currentState.env1Decay = uiToHex(randRange(decayMin, decayMax), 0, 50);
    currentState.env1Sustain = uiToHex(randRange(20, 50), 0, 50);
    currentState.env1Release = uiToHex(randRange(releaseMin, releaseMax), 0, 50);
    
    // ENV2 (modulation) - slightly shorter for modulation
    currentState.env2Attack = uiToHex(randRange(attackMin * 0.7, attackMax * 0.7), -25, 25);
    currentState.env2Decay = uiToHex(randRange(decayMin * 0.5, decayMax * 0.5), -25, 25);
    currentState.env2Sustain = uiToHex(randRange(-25, 25), -25, 25);
    currentState.env2Release = uiToHex(randRange(releaseMin * 0.7, releaseMax * 0.7), -25, 25);
    
    // ENV3 & ENV4 (optional modulation) - 50% chance
    if (Math.random() < 0.5) {
        currentState.env3Attack = uiToHex(randRange(0, attackMax * 0.5), -25, 25);
        currentState.env3Decay = uiToHex(randRange(-10, decayMax * 0.3), -25, 25);
        currentState.env3Sustain = uiToHex(randRange(-15, 15), -25, 25);
        currentState.env3Release = uiToHex(randRange(0, releaseMax * 0.5), -25, 25);
    }
}

// ============================================================================
// FX MORPHING
// ============================================================================

function morphFX() {
    const amount = morphSettings.fx.amount / 100;
    
    // Skip if amount is 0
    if (amount === 0) {
        // Turn off all FX
        currentState.modFXType = 'none';
        currentState.delayRate = uiToHex(0, 0, 50);
        currentState.delayFeedback = uiToHex(0, 0, 50);
        currentState.reverbAmount = uiToHex(0, 0, 50);
        return;
    }
    
    const maxFX = MORPH_LIMITS.FX_LEVEL_MAX;
    
    // ModFX - 70% chance to enable (increases with amount)
    if (Math.random() < (0.3 + amount * 0.4)) {
        const modFXTypes = ['flanger', 'chorus', 'phaser', 'StereoChorus', 'warble'];
        currentState.modFXType = randChoice(modFXTypes);
        // Direct scaling: slider at 50% = 50% of max depth
        currentState.modFXRate = uiToHex(randRange(5, 45 * amount), 0, 50);
        currentState.modFXDepth = uiToHex(randRange(10, maxFX * amount), 0, 50);
    } else {
        currentState.modFXType = 'none';
    }
    
    // Delay - probability increases with amount (30% to 80%)
    const useDelay = Math.random() < (0.3 + amount * 0.5);
    if (useDelay) {
        // Direct scaling: slider controls wet/dry mix
        currentState.delayRate = uiToHex(randRange(5, MORPH_LIMITS.DELAY_RATE_MAX * amount), 0, 50);
        // Feedback scales directly: 0 = no feedback, 100 = max feedback (25)
        currentState.delayFeedback = uiToHex(randRange(5, MORPH_LIMITS.DELAY_FEEDBACK_MAX * amount), 0, 50);
        currentState.delayPingPong = randChoice(['0', '1']);
        currentState.delayAnalog = randChoice(['0', '1']);
    } else {
        currentState.delayRate = uiToHex(0, 0, 50);
        currentState.delayFeedback = uiToHex(0, 0, 50);
    }
    
    // Reverb - always on when FX amount > 0, scales directly with slider
    // 0 = no reverb, 100 = max reverb (up to safety limit of 80)
    const reverbAmount = randRange(5, maxFX * amount);
    currentState.reverbAmount = uiToHex(reverbAmount, 0, 50);
}

// ============================================================================
// MODULATION MORPHING
// ============================================================================

function morphModulation() {
    const depth = morphSettings.modulation.depth / 100;
    
    // Skip if depth is 0
    if (depth === 0) return;
    
    // Clear existing patch cables
    patchCables = [];
    
    // Add common/essential modulations first
    const commonModulations = [
        { sources: ['lfo1', 'lfo2'], dest: 'lpfFrequency', chance: 0.7 },
        { sources: ['env2', 'env3'], dest: 'lpfFrequency', chance: 0.5 },
        { sources: ['lfo1'], dest: 'hpfFrequency', chance: 0.3 }
    ];
    
    // If using wavetables, prioritize wavetable position modulation
    if (currentState.osc1Type === 'wavetable') {
        commonModulations.push({ sources: ['lfo1', 'lfo2', 'lfo3'], dest: 'oscAWavetablePosition', chance: 0.8 });
        commonModulations.push({ sources: ['env2', 'env3'], dest: 'oscAWavetablePosition', chance: 0.6 });
    }
    if (currentState.osc2Type === 'wavetable') {
        commonModulations.push({ sources: ['lfo1', 'lfo2', 'lfo3'], dest: 'oscBWavetablePosition', chance: 0.8 });
        commonModulations.push({ sources: ['env2', 'env3'], dest: 'oscBWavetablePosition', chance: 0.6 });
    }
    
    const usedCombos = new Set();
    
    commonModulations.forEach(mod => {
        if (Math.random() < mod.chance) {
            const source = randChoice(mod.sources);
            const combo = `${source}->${mod.dest}`;
            
            if (!usedCombos.has(combo)) {
                const minAmount = MORPH_LIMITS.MOD_AMOUNT_MIN;
                const maxAmount = minAmount + (depth * (MORPH_LIMITS.MOD_AMOUNT_MAX - minAmount));
                const amount = randRange(-maxAmount, maxAmount);
                
                patchCables.push({
                    source: source,
                    destination: mod.dest,
                    amount: uiToHex(amount, -50, 50)
                });
                
                usedCombos.add(combo);
            }
        }
    });
    
    // Generate random number of additional cables
    const numCables = randInt(MORPH_LIMITS.MOD_CABLES_MIN, 
                              Math.ceil(MORPH_LIMITS.MOD_CABLES_MIN + depth * (MORPH_LIMITS.MOD_CABLES_MAX - MORPH_LIMITS.MOD_CABLES_MIN)));
    
    // Available sources and destinations
    // Exclude 'none' from sources
    const sources = modSources.filter(s => s !== 'none');
    const destinations = modDestinations;
    
    for (let i = 0; i < numCables; i++) {
        let source, destination, combo;
        let attempts = 0;
        
        // Find unique combination
        do {
            source = randChoice(sources);
            destination = randChoice(destinations);
            combo = `${source}->${destination}`;
            attempts++;
        } while (usedCombos.has(combo) && attempts < 50);
        
        if (attempts >= 50) break; // Avoid infinite loop
        
        usedCombos.add(combo);
        
        // Calculate amount based on depth slider
        const minAmount = MORPH_LIMITS.MOD_AMOUNT_MIN;
        const maxAmount = minAmount + (depth * (MORPH_LIMITS.MOD_AMOUNT_MAX - minAmount));
        const amount = randRange(-maxAmount, maxAmount);
        
        patchCables.push({
            source: source,
            destination: destination,
            amount: uiToHex(amount, -50, 50)
        });
    }
    
    renderPatchCables();
}

// ============================================================================
// FILE SELECTION
// ============================================================================

async function selectRandomFile(oscNum, folderPath) {
    // If not connected to Deluge, can't browse files
    if (!delugeOutput) {
        console.warn('Cannot select random file - not connected to Deluge');
        currentState[`osc${oscNum}File`] = '';
        return;
    }
    
    try {
        // Recursively collect all .wav files from folder and subfolders
        const wavFiles = await collectWavFiles(folderPath);
        
        // Select random file
        if (wavFiles.length > 0) {
            currentState[`osc${oscNum}File`] = randChoice(wavFiles);
            console.log(`Selected random file for OSC${oscNum}:`, currentState[`osc${oscNum}File`]);
        } else {
            console.warn(`No .wav files found in ${folderPath} for OSC${oscNum}`);
            currentState[`osc${oscNum}File`] = '';
            
            // Show warning to user (only once per morph)
            if (oscNum === 1 && !window._morphFileWarningShown) {
                showNotification(`⚠️ No .wav files found in ${folderPath}. Sample/Wavetable patches will have empty file paths.`, true);
                window._morphFileWarningShown = true;
                setTimeout(() => { window._morphFileWarningShown = false; }, 5000);
            }
        }
    } catch (error) {
        console.error('Error selecting random file:', error);
        currentState[`osc${oscNum}File`] = '';
    }
}

async function collectWavFiles(folderPath, maxDepth = 3, currentDepth = 0) {
    const wavFiles = [];
    
    if (currentDepth >= maxDepth) return wavFiles;
    
    try {
        console.log(`Scanning folder (depth ${currentDepth}):`, folderPath);
        const entries = await listDirectory(folderPath);
        
        // Get .wav files in current directory, excluding hidden/system files
        const validFiles = entries.filter(e => {
            const isDir = (e.attr & 0x10) !== 0; // Check attr field: bit 4 (0x10) = directory
            if (isDir) return false; // Not a file
            if (!e.name.toLowerCase().endsWith('.wav')) return false; // Not a .wav file
            
            // Filter out hidden/system files
            if (e.name.startsWith('.')) return false; // Hidden files like .DS_Store
            if (e.name.startsWith('._')) return false; // macOS resource fork files
            if (e.name.toLowerCase() === 'desktop.ini') return false; // Windows system file
            
            return true;
        });
        
        console.log(`  Found ${validFiles.length} valid .wav files in ${folderPath}`);
        validFiles.forEach(f => wavFiles.push(folderPath + f.name));
        
        // Recursively get files from subdirectories
        const subdirs = entries.filter(e => (e.attr & 0x10) !== 0);
        console.log(`  Found ${subdirs.length} subdirectories to scan`);
        
        for (const dir of subdirs) {
            const subPath = folderPath + dir.name + '/';
            const subFiles = await collectWavFiles(subPath, maxDepth, currentDepth + 1);
            wavFiles.push(...subFiles);
        }
    } catch (err) {
        console.warn('Could not read folder:', folderPath, err);
    }
    
    console.log(`Total files collected from ${folderPath}:`, wavFiles.length);
    return wavFiles;
}

async function browseMorphFolder() {
    if (!delugeOutput) {
        showNotification('✗ Not connected to Deluge', true);
        return;
    }
    
    // Set mode to 'morphfolder' so file-browser knows to set folder path instead of file
    currentSampleBrowserMode = 'morphfolder';
    currentSampleBrowserPath = morphSettings.oscillators.sampleFolder || '/SAMPLES/';
    
    // Show the sample browser modal
    const modal = document.getElementById('sampleBrowserModal');
    if (!modal) {
        showNotification('✗ Sample browser not found', true);
        return;
    }
    
    const title = modal.querySelector('.modal-title');
    if (title) {
        title.textContent = 'Select Folder for Random Files';
    }
    
    modal.classList.add('show');
    
    // Load the directory
    await loadSampleDirectory('/SAMPLES/');
}

function updateSelectedFilesDisplay() {
    const displayElement = document.getElementById('morphSelectedFiles');
    if (!displayElement) return;
    
    const files = [];
    
    // Collect and update OSC1 file
    if (currentState.osc1File && currentState.osc1File !== '') {
        const filename = currentState.osc1File.substring(currentState.osc1File.lastIndexOf('/') + 1);
        files.push(`OSC1: ${filename}`);
        
        // Update the osc1File input field
        const osc1FileInput = document.getElementById('osc1File');
        if (osc1FileInput) {
            osc1FileInput.value = currentState.osc1File;
        }
    }
    
    // Collect and update OSC2 file
    if (currentState.osc2File && currentState.osc2File !== '') {
        const filename = currentState.osc2File.substring(currentState.osc2File.lastIndexOf('/') + 1);
        files.push(`OSC2: ${filename}`);
        
        // Update the osc2File input field
        const osc2FileInput = document.getElementById('osc2File');
        if (osc2FileInput) {
            osc2FileInput.value = currentState.osc2File;
        }
    }
    
    // Update display
    if (files.length > 0) {
        displayElement.textContent = '🎵 ' + files.join(' | ');
        displayElement.style.display = 'block';
    } else {
        displayElement.style.display = 'none';
    }
}

// ============================================================================
// MAIN MORPH FUNCTION
// ============================================================================

async function executePatchMorph() {
    if (!confirm('Morph current patch with random variations based on your settings?')) {
        return;
    }
    
    // Update settings from UI first
    updateMorphSettings();
    
    showNotification('🎲 Morphing patch...');
    
    // Apply morphing based on slider amounts (0 = skip that section)
    await morphOscillators();
    morphFilters();
    morphEnvelopes();
    morphFX();
    morphModulation();
    
    // Update UI
    updateUIFromState();
    
    // Send MIDI CC for all changed parameters (if MIDI CC is enabled)
    console.log('Patch morph complete, checking for sendAllMIDICCs function...');
    if (typeof sendAllMIDICCs === 'function') {
        console.log('sendAllMIDICCs function found, calling it...');
        sendAllMIDICCs();
    } else {
        console.warn('sendAllMIDICCs function not found!');
    }
    
    // Display selected wavetable/sample files
    updateSelectedFilesDisplay();
    
    // Generate creative preset name (if enabled)
    const generateName = document.getElementById('morphGenerateName');
    if (generateName && generateName.checked) {
        // Build oscillator type prefix
        const oscTypeMap = {
            'sine': 'SIN',
            'triangle': 'TRI',
            'square': 'SQU',
            'analogSquare': 'SQU',
            'saw': 'SAW',
            'analogSaw': 'SAW',
            'wavetable': 'WVT',
            'sample': 'SMP'
        };
        
        let oscPrefix = '';
        const osc1Short = oscTypeMap[currentState.osc1Type] || '';
        const osc2Short = oscTypeMap[currentState.osc2Type] || '';
        
        if (osc1Short && osc2Short && osc1Short !== osc2Short) {
            oscPrefix = osc1Short + osc2Short;
        } else if (osc1Short) {
            oscPrefix = osc1Short;
        }
        
        // Add synth mode prefix if not subtractive
        let modePrefix = '';
        if (currentState.mode === 'fm') {
            modePrefix = 'FM ';
        } else if (currentState.mode === 'ringmod') {
            modePrefix = 'RING ';
        }
        
        const suffixes = [
            'Dream', 'Space', 'Texture', 'Vibe', 'Chaos', 'Flow', 'Pulse', 'Wave','Key', 'Stab', 'Hit', 'Sweep',
            'Drone', 'Arp', 'Seq', 'Loop', 'Bell', 'String', 'Brass', 'Wind',
            'Shimmer', 'Glow', 'Shadow', 'Echo', 'Drift', 'Rise', 'Fall', 'Swell',
            'Atmosphere', 'Soundscape', 'Movement', 'Motion', 'Energy', 'Force', 'Power', 'Bloom',
            'Crystal', 'Nebula', 'Void', 'Abyss', 'Ocean', 'Storm', 'Rain', 'Thunder',
            'Circuit', 'Signal', 'Noise', 'Static', 'Frequency', 'Resonance', 'Harmonic', 'Spectrum',
            'Journey', 'Quest', 'Adventure', 'Mystery', 'Wonder', 'Discovery', 'Revelation', 'Vision'
        ];
        
        // Build final name: MODE + OSC + SUFFIX + NUMBER
        const newName = `${modePrefix}${oscPrefix} ${randChoice(suffixes)} ${randInt(1, 99)}`;
        document.getElementById('presetName').value = newName;
        updateSavePathIndicator();
        showNotification('✓ Patch morphed with new name!');
    } else {
        showNotification('✓ Patch morphed! (Name preserved)');
    }
}

// ============================================================================
// MASTER CONTROLS
// ============================================================================

function resetMorphSliders() {
    // Set all sliders to 0
    document.getElementById('morphOscAmount').value = 0;
    document.getElementById('morphFilterAmount').value = 0;
    document.getElementById('morphEnvLength').value = 0;
    document.getElementById('morphFXAmount').value = 0;
    document.getElementById('morphModDepth').value = 0;
    document.getElementById('morphMasterAmount').value = 0;
    
    // Update displays
    updateMorphSettings();
    updateMasterSliderLabel(0);
}

function setAllMorphSliders(value) {
    // Set individual sliders with variation around the master value
    // This creates more organic, musical randomization
    const variance = Math.max(5, value * 0.15); // 15% variance, minimum 5
    
    const randomize = (baseValue) => {
        const offset = randRange(-variance, variance);
        return Math.max(0, Math.min(100, Math.round(baseValue + offset)));
    };
    
    document.getElementById('morphOscAmount').value = randomize(value);
    document.getElementById('morphFilterAmount').value = randomize(value);
    document.getElementById('morphEnvLength').value = randomize(value);
    document.getElementById('morphFXAmount').value = randomize(value);
    document.getElementById('morphModDepth').value = randomize(value);
    
    // Update displays
    updateMorphSettings();
}

function updateMasterSliderLabel(value) {
    const label = document.getElementById('morphMasterAmountValue');
    if (!label) return;
    
    if (value === 0) {
        label.textContent = '0 - All Off';
    } else if (value < 25) {
        label.textContent = value + ' - Subtle';
    } else if (value < 50) {
        label.textContent = value + ' - Moderate';
    } else if (value < 75) {
        label.textContent = value + ' - Strong';
    } else {
        label.textContent = value + ' - Extreme';
    }
}

// ============================================================================
// UI UPDATE FUNCTIONS
// ============================================================================

function updateMorphSettings() {
    // Read settings from UI
    morphSettings.oscillators.randomizePitch = document.getElementById('morphOscPitch').checked;
    morphSettings.oscillators.includeStandard = document.getElementById('morphOscStandard').checked;
    morphSettings.oscillators.includeWavetable = document.getElementById('morphOscWavetable').checked;
    morphSettings.oscillators.includeSample = document.getElementById('morphOscSample').checked;
    morphSettings.oscillators.amount = parseInt(document.getElementById('morphOscAmount').value);
    
    morphSettings.filters.amount = parseInt(document.getElementById('morphFilterAmount').value);
    morphSettings.envelopes.length = parseInt(document.getElementById('morphEnvLength').value);
    morphSettings.fx.amount = parseInt(document.getElementById('morphFXAmount').value);
    morphSettings.modulation.depth = parseInt(document.getElementById('morphModDepth').value);
    
    // Show/hide folder section if wavetable or sample is enabled
    const folderSection = document.getElementById('morphSampleFolderSection');
    const browseBtn = document.getElementById('morphBrowseSampleFolder');
    const showFolder = morphSettings.oscillators.includeWavetable || morphSettings.oscillators.includeSample;
    if (folderSection) {
        folderSection.style.display = showFolder ? 'block' : 'none';
    }
    if (browseBtn && delugeOutput) {
        browseBtn.style.display = showFolder ? 'inline' : 'none';
    }
    
    // Update slider value displays
    document.getElementById('morphOscAmountValue').textContent = morphSettings.oscillators.amount;
    document.getElementById('morphFilterAmountValue').textContent = morphSettings.filters.amount;
    document.getElementById('morphEnvLengthValue').textContent = getEnvLengthLabel(morphSettings.envelopes.length);
    document.getElementById('morphFXAmountValue').textContent = getFXAmountLabel(morphSettings.fx.amount);
    document.getElementById('morphModDepthValue').textContent = getModDepthLabel(morphSettings.modulation.depth);
}

function getEnvLengthLabel(value) {
    if (value < 25) return 'Very Short';
    if (value < 40) return 'Short';
    if (value < 60) return 'Medium';
    if (value < 80) return 'Long';
    return 'Very Long';
}

function getFXAmountLabel(value) {
    if (value < 20) return 'Minimal';
    if (value < 40) return 'Subtle';
    if (value < 60) return 'Moderate';
    if (value < 80) return 'Heavy';
    return 'Extreme';
}

function getModDepthLabel(value) {
    if (value < 20) return 'Subtle';
    if (value < 40) return 'Light';
    if (value < 60) return 'Moderate';
    if (value < 80) return 'Strong';
    return 'Extreme';
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Setup morph control listeners
    const morphControls = [
        'morphGenerateName',
        'morphOscPitch', 'morphOscStandard', 'morphOscWavetable', 'morphOscSample', 'morphOscAmount',
        'morphFilterAmount', 'morphEnvLength', 'morphFXAmount', 'morphModDepth'
    ];
    
    morphControls.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', updateMorphSettings);
            element.addEventListener('input', updateMorphSettings);
        }
    });
    
    // Setup master slider
    const masterSlider = document.getElementById('morphMasterAmount');
    if (masterSlider) {
        masterSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            setAllMorphSliders(value);
            updateMasterSliderLabel(value);
        });
    }
    
    // Initialize displays
    updateMorphSettings();
    updateMasterSliderLabel(0);
});

