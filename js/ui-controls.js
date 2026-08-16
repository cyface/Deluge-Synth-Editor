// Deluge Synth Editor - UI Controls
// Knobs, tabs, envelope visualization, modulation matrix

// ============================================================================
// KNOB INTERACTION
// ============================================================================

let isDragging = false;
let currentKnob = null;
let startY = 0;
let startValue = 0;

function initializeKnobs() {
    const knobs = document.querySelectorAll('.knob');

    knobs.forEach(knob => {
        const paramName = knob.dataset.param;
        const min = parseFloat(knob.dataset.min);
        const max = parseFloat(knob.dataset.max);

        // Initialize from current state
        if (currentState[paramName]) {
            const uiValue = hexToUI(currentState[paramName], min, max);
            updateKnobDisplay(knob, uiValue, min, max);
        }

        // Mouse events
        knob.addEventListener('mousedown', (e) => {
            isDragging = true;
            currentKnob = knob;
            startY = e.clientY;
            startValue = parseFloat(knob.dataset.value) || 0;
            e.preventDefault();
        });

        // Touch events
        knob.addEventListener('touchstart', (e) => {
            isDragging = true;
            currentKnob = knob;
            startY = e.touches[0].clientY;
            startValue = parseFloat(knob.dataset.value) || 0;
            e.preventDefault();
        });
    });

    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (isDragging && currentKnob) {
            const deltaY = startY - e.clientY;
            const sensitivity = 0.5;
            const min = parseFloat(currentKnob.dataset.min);
            const max = parseFloat(currentKnob.dataset.max);
            let newValue = startValue + (deltaY * sensitivity);
            newValue = Math.max(min, Math.min(max, newValue));

            updateKnobDisplay(currentKnob, newValue, min, max);
            updateParameter(currentKnob.dataset.param, newValue, min, max);
        }
    });

    // Global touch move
    document.addEventListener('touchmove', (e) => {
        if (isDragging && currentKnob) {
            const deltaY = startY - e.touches[0].clientY;
            const sensitivity = 0.5;
            const min = parseFloat(currentKnob.dataset.min);
            const max = parseFloat(currentKnob.dataset.max);
            let newValue = startValue + (deltaY * sensitivity);
            newValue = Math.max(min, Math.min(max, newValue));

            updateKnobDisplay(currentKnob, newValue, min, max);
            updateParameter(currentKnob.dataset.param, newValue, min, max);
        }
    });

    // Global mouse up
    document.addEventListener('mouseup', () => {
        isDragging = false;
        currentKnob = null;
    });

    // Global touch end
    document.addEventListener('touchend', () => {
        isDragging = false;
        currentKnob = null;
    });
}

function updateKnobDisplay(knob, value, min, max) {
    knob.dataset.value = value;

    // Calculate rotation (-135 to 135 degrees)
    const normalized = (value - min) / (max - min);
    const degrees = -135 + (normalized * 270);
    knob.style.transform = `rotate(${degrees}deg)`;

    // Update value display
    const paramName = knob.dataset.param;
    const valueDisplay = document.getElementById(paramName + 'Value');
    if (valueDisplay) {
        valueDisplay.textContent = formatDisplayValue(paramName, value);
    }
}

function updateParameter(paramName, uiValue, min = -50, max = 50) {
    currentState[paramName] = uiToHex(uiValue, min, max);

    // Send MIDI CC if enabled
    if (typeof sendMIDICC === 'function') {
        sendMIDICC(paramName, uiValue, min, max);
    }

    // If this is an envelope parameter, redraw the envelope in real-time
    if (paramName.startsWith('env')) {
        const envNum = paramName.charAt(3); // Get envelope number (1-4)
        updateEnvelopeDisplay(envNum);
    }
}

// Update a specific envelope display
function updateEnvelopeDisplay(envNum) {
    drawEnvelope(
        `env${envNum}Canvas`,
        hexToUI(currentState[`env${envNum}Attack`], 0, 50),
        hexToUI(currentState[`env${envNum}Decay`], 0, 50),
        hexToUI(currentState[`env${envNum}Sustain`], 0, 50),
        hexToUI(currentState[`env${envNum}Release`], 0, 50),
        0,
        50
    );
}

// ============================================================================
// TAB NAVIGATION
// ============================================================================

function showTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabName).classList.add('active');

    // Activate corresponding tab button
    event.target.classList.add('active');

    // Redraw envelopes if on envelope tab
    if (tabName === 'envelopes') {
        updateEnvelopeDisplay('1');
        updateEnvelopeDisplay('2');
        updateEnvelopeDisplay('3');
        updateEnvelopeDisplay('4');
    }
}

// ============================================================================
// ENVELOPE VISUALIZATION
// ============================================================================

function drawEnvelope(canvasId, attack, decay, sustain, release, sustainMin = 0, sustainMax = 50) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = canvas.offsetHeight;

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    // Normalize values
    const a = Math.max(0, attack) / 50;
    const d = Math.max(0, decay) / 50;
    // Sustain can be bipolar for mod envelopes
    const sustainRange = sustainMax - sustainMin;
    const s = (Math.max(sustainMin, Math.min(sustainMax, sustain)) - sustainMin) / sustainRange;
    const r = Math.max(0, release) / 50;

    // Scale for drawing
    // Attack/Decay/Release: minimum 2px (nearly vertical), maximum 100px
    const attackTime = a < 0.01 ? 2 : 2 + a * 98;
    const decayTime = d < 0.01 ? 2 : 2 + d * 98;
    const sustainTime = 60;
    const releaseTime = r < 0.01 ? 2 : 2 + r * 98;

    const totalTime = attackTime + decayTime + sustainTime + releaseTime;
    const scale = (width - 40) / totalTime;

    // Draw envelope
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();

    // Start
    let x = 20;
    let y = height - 20;
    ctx.moveTo(x, y);

    // Attack
    x += attackTime * scale;
    y = 20;
    ctx.lineTo(x, y);

    // Decay
    x += decayTime * scale;
    y = 20 + (1 - s) * (height - 40);
    ctx.lineTo(x, y);

    // Sustain
    x += sustainTime * scale;
    ctx.lineTo(x, y);

    // Release
    x += releaseTime * scale;
    y = height - 20;
    ctx.lineTo(x, y);

    ctx.stroke();

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);

    // Horizontal lines
    for (let i = 1; i < 4; i++) {
        const gridY = 20 + (i / 4) * (height - 40);
        ctx.beginPath();
        ctx.moveTo(20, gridY);
        ctx.lineTo(width - 20, gridY);
        ctx.stroke();
    }

    ctx.setLineDash([]);
}

// ============================================================================
// MODULATION MATRIX
// ============================================================================

function addPatchCable() {
    // No polarity: the firmware defaults it per modulation source, which is a
    // better choice than any we can make without UI for it. (rangeAdjustable
    // used to be set here in the belief it meant "bipolar" - it does not, see
    // the patchCable notes in generateXML.)
    const cable = {
        source: 'velocity',
        destination: 'volume',
        amount: '0x3FFFFFE8'
    };

    patchCables.push(cable);
    renderPatchCables();
}

function removePatchCable(index) {
    patchCables.splice(index, 1);
    renderPatchCables();
}

function updatePatchCable(index, field, value) {
    if (field === 'amount') {
        // Convert percentage to hex
        const uiValue = parseFloat(value);
        patchCables[index][field] = uiToHex(uiValue, -50, 50);
    } else {
        patchCables[index][field] = value;
    }
}

// The FM-only destinations get explicit labels; the Deluge calls
// modulator amount "Mod level" (params::LOCAL_MODULATOR_n_VOLUME).
const FM_DEST_LABELS = {
    carrier1Feedback: 'Carrier 1 Feedback (FM)',
    carrier2Feedback: 'Carrier 2 Feedback (FM)',
    modulator1Amount: 'Modulator 1 Level (FM)',
    modulator1Feedback: 'Modulator 1 Feedback (FM)',
    modulator2Amount: 'Modulator 2 Level (FM)',
    modulator2Feedback: 'Modulator 2 Feedback (FM)',
};

function formatModDestinationLabel(dest) {
    if (FM_DEST_LABELS[dest]) return FM_DEST_LABELS[dest];
    return (dest.charAt(0).toUpperCase() + dest.slice(1).replace(/([A-Z])/g, ' $1'))
        .replace(/\bLpf\b/, 'LPF')
        .replace(/\bHpf\b/, 'HPF')
        .replace(/\bLfo/, 'LFO')
        .replace(/\bMod F X\b/, 'Mod FX');
}

function renderPatchCables() {
    const container = document.getElementById('patchCablesContainer');
    container.innerHTML = '';

    patchCables.forEach((cable, index) => {
        const row = document.createElement('div');
        row.className = 'mod-row';

        // Source select
        const sourceSelect = document.createElement('select');
        modSources.forEach(source => {
            const option = document.createElement('option');
            option.value = source;
            option.textContent = modSourceLabels[source] || (source.charAt(0).toUpperCase() + source.slice(1));
            if (source === cable.source) option.selected = true;
            sourceSelect.appendChild(option);
        });
        sourceSelect.onchange = (e) => updatePatchCable(index, 'source', e.target.value);

        // Destination select
        const destSelect = document.createElement('select');
        modDestinations.forEach(dest => {
            const option = document.createElement('option');
            option.value = dest;
            option.textContent = formatModDestinationLabel(dest);
            if (dest === cable.destination) option.selected = true;
            destSelect.appendChild(option);
        });
        destSelect.onchange = (e) => updatePatchCable(index, 'destination', e.target.value);

        // Amount slider
        const amountContainer = document.createElement('div');
        amountContainer.style.display = 'flex';
        amountContainer.style.flexDirection = 'column';

        const amountSlider = document.createElement('input');
        amountSlider.type = 'range';
        amountSlider.min = '-50';
        amountSlider.max = '50';
        amountSlider.value = hexToUI(cable.amount, -50, 50).toFixed(0);
        amountSlider.oninput = (e) => updatePatchCable(index, 'amount', e.target.value);

        const amountValue = document.createElement('div');
        amountValue.className = 'slider-value';
        amountValue.textContent = amountSlider.value;
        amountSlider.oninput = (e) => {
            updatePatchCable(index, 'amount', e.target.value);
            amountValue.textContent = e.target.value;
        };

        amountContainer.appendChild(amountSlider);
        amountContainer.appendChild(amountValue);

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.onclick = () => removePatchCable(index);

        row.appendChild(sourceSelect);
        row.appendChild(destSelect);
        row.appendChild(amountContainer);
        row.appendChild(removeBtn);

        container.appendChild(row);
    });
}


// ============================================================================
// SLIDER READOUTS
// ============================================================================

// Show a full-scale slider's position in the units the Deluge displays.
function updateSliderReadout(param) {
    const readout = document.getElementById(param + 'Readout');
    if (!readout) return;

    const pos = parseInt(currentState[param], 10);
    readout.textContent = Number.isNaN(pos) ? '-' : sliderReadouts[param](pos);
}

// ============================================================================
// GOLD KNOB ASSIGNMENTS
// ============================================================================

// Turn a camelCase param name into a label. Splitting on every capital alone
// gives "Volume Post F X" and "Lpf Frequency", so keep runs of capitals
// together and restore the ones that are really acronyms.
function formatParamLabel(name) {
    const spaced = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    return (spaced.charAt(0).toUpperCase() + spaced.slice(1))
        .replace(/\b(Lpf|Hpf|Fx|Lfo|Mpe|Osc)(\d*)\b/g, m => m.toUpperCase());
}

function updateModKnob(index, field, value) {
    if (!modKnobs[index]) modKnobs[index] = { ...DEFAULT_MOD_KNOBS[index] };

    // An empty source means "plain parameter control", which the file format
    // expresses by leaving the attribute off entirely rather than by writing
    // "none" - stringToSource would map that to NOT_AVAILABLE anyway, but the
    // Deluge never writes it and neither should we.
    if (field !== 'controlsParam' && !value) {
        delete modKnobs[index][field];
    } else {
        modKnobs[index][field] = value;
    }

    // A second source is only meaningful on top of a first one.
    if (field === 'patchAmountFromSource' && !value) {
        delete modKnobs[index].patchAmountFromSecondSource;
        renderModKnobs();
    }
}

function resetModKnobs() {
    modKnobs = DEFAULT_MOD_KNOBS.map(knob => ({ ...knob }));
    renderModKnobs();
    showNotification('✓ Gold knobs reset to Deluge defaults');
}

function renderModKnobs() {
    const container = document.getElementById('modKnobsContainer');
    if (!container) return;

    container.innerHTML = '';

    MOD_KNOB_PAGES.forEach((pageName, page) => {
        const group = document.createElement('div');
        group.className = 'mod-knob-page';

        const heading = document.createElement('div');
        heading.className = 'mod-knob-page-title';
        heading.textContent = `${page + 1}. ${pageName}`;
        group.appendChild(heading);

        // Knob 1 is the top knob, knob 0 the bottom one, but the file stores
        // bottom first. Show them top-first to match the hardware layout.
        [1, 0].forEach(which => {
            const index = page * 2 + which;
            const knob = modKnobs[index] || DEFAULT_MOD_KNOBS[index];

            const row = document.createElement('div');
            row.className = 'mod-knob-row';

            const label = document.createElement('span');
            label.className = 'mod-knob-label';
            label.textContent = which === 1 ? 'Top' : 'Bottom';
            row.appendChild(label);

            const paramSelect = document.createElement('select');
            modKnobParams.forEach(param => {
                const option = document.createElement('option');
                option.value = param;
                option.textContent = formatParamLabel(param);
                if (param === knob.controlsParam) option.selected = true;
                paramSelect.appendChild(option);
            });
            paramSelect.onchange = (e) => updateModKnob(index, 'controlsParam', e.target.value);
            row.appendChild(paramSelect);

            // Optional: make the knob control a patch cable's depth instead of
            // the parameter directly, the way the default Reverb/Sidechain and
            // LFO/Pitch knobs do.
            const sourceSelect = document.createElement('select');
            sourceSelect.title = 'Control this parameter’s modulation depth from this source, instead of the parameter itself';
            ['', ...modSources.filter(s => s !== 'none')].forEach(source => {
                const option = document.createElement('option');
                option.value = source;
                option.textContent = source ? 'from ' + source : 'direct';
                if (source === (knob.patchAmountFromSource || '')) option.selected = true;
                sourceSelect.appendChild(option);
            });
            sourceSelect.onchange = (e) => updateModKnob(index, 'patchAmountFromSource', e.target.value);
            row.appendChild(sourceSelect);

            if (knob.patchAmountFromSource) {
                const secondSelect = document.createElement('select');
                secondSelect.title = 'Second modulation source, for a cable modulating another cable';
                ['', ...modSources.filter(s => s !== 'none')].forEach(source => {
                    const option = document.createElement('option');
                    option.value = source;
                    option.textContent = source ? '+ ' + source : '(none)';
                    if (source === (knob.patchAmountFromSecondSource || '')) option.selected = true;
                    secondSelect.appendChild(option);
                });
                secondSelect.onchange = (e) => updateModKnob(index, 'patchAmountFromSecondSource', e.target.value);
                row.appendChild(secondSelect);
            }

            group.appendChild(row);
        });

        container.appendChild(group);
    });
}

// ============================================================================
// DX7 UI TOGGLE
// ============================================================================

/**
 * Setup oscillator type change listeners to show/hide DX7 UI
 */
function setupOscillatorTypeListeners() {
    const osc1Type = document.getElementById('osc1Type');
    const osc2Type = document.getElementById('osc2Type');
    
    if (osc1Type) {
        osc1Type.addEventListener('change', () => {
            const isDX7 = osc1Type.value === 'dx7';
            const isSampleType = osc1Type.value === 'sample' || osc1Type.value === 'wavetable';
            
            // Show/hide DX7 container
            const dx7Container = document.getElementById('osc1DX7Container');
            if (dx7Container) {
                dx7Container.style.display = isDX7 ? 'block' : 'none';
            }
            if (isDX7) {
                initializeDX7UI(1);
            }
            
            // Show/hide file container
            const fileContainer = document.getElementById('osc1FileContainer');
            if (fileContainer) {
                fileContainer.style.display = isSampleType ? 'block' : 'none';
            }
            
            // Clear sample/wavetable file if not using sample type
            if (!isSampleType) {
                const fileInput = document.getElementById('osc1File');
                if (fileInput && fileInput.value) {
                    fileInput.value = '';
                    currentState.osc1File = '';
                }
            }
        });
    }
    
    if (osc2Type) {
        osc2Type.addEventListener('change', () => {
            const isDX7 = osc2Type.value === 'dx7';
            const isSampleType = osc2Type.value === 'sample' || osc2Type.value === 'wavetable';
            
            // Show/hide DX7 container
            const dx7Container = document.getElementById('osc2DX7Container');
            if (dx7Container) {
                dx7Container.style.display = isDX7 ? 'block' : 'none';
            }
            if (isDX7) {
                initializeDX7UI(2);
            }
            
            // Show/hide file container
            const fileContainer = document.getElementById('osc2FileContainer');
            if (fileContainer) {
                fileContainer.style.display = isSampleType ? 'block' : 'none';
            }
            
            // Clear sample/wavetable file if not using sample type
            if (!isSampleType) {
                const fileInput = document.getElementById('osc2File');
                if (fileInput && fileInput.value) {
                    fileInput.value = '';
                    currentState.osc2File = '';
                }
            }
        });
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    setupOscillatorTypeListeners();
});
