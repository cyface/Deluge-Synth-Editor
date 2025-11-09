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

    // If this is an envelope parameter, redraw the envelope in real-time
    if (paramName.startsWith('env')) {
        const envNum = paramName.charAt(3); // Get envelope number (1-4)
        updateEnvelopeDisplay(envNum);
    }
}

// Update a specific envelope display
function updateEnvelopeDisplay(envNum) {
    const sustainMin = envNum === '1' ? 0 : -25;
    const sustainMax = envNum === '1' ? 50 : 25;

    drawEnvelope(
        `env${envNum}Canvas`,
        hexToUI(currentState[`env${envNum}Attack`], 0, 50),
        hexToUI(currentState[`env${envNum}Decay`], 0, 50),
        hexToUI(currentState[`env${envNum}Sustain`], sustainMin, sustainMax),
        hexToUI(currentState[`env${envNum}Release`], 0, 50),
        sustainMin,
        sustainMax
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
    ctx.strokeStyle = '#ff6b35';
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
            option.textContent = source.charAt(0).toUpperCase() + source.slice(1);
            if (source === cable.source) option.selected = true;
            sourceSelect.appendChild(option);
        });
        sourceSelect.onchange = (e) => updatePatchCable(index, 'source', e.target.value);

        // Destination select
        const destSelect = document.createElement('select');
        modDestinations.forEach(dest => {
            const option = document.createElement('option');
            option.value = dest;
            option.textContent = dest.charAt(0).toUpperCase() + dest.replace(/([A-Z])/g, ' $1').trim();
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
            console.log('🔄 OSC1 Type changed to:', osc1Type.value);
            const isDX7 = osc1Type.value === 'dx7';
            const container = document.getElementById('osc1DX7Container');
            if (container) {
                container.style.display = isDX7 ? 'block' : 'none';
            }
            if (isDX7) {
                console.log('   Calling initializeDX7UI(1)...');
                initializeDX7UI(1);
            }
        });
        console.log('✅ OSC1 type change listener added');
    }
    
    if (osc2Type) {
        osc2Type.addEventListener('change', () => {
            console.log('🔄 OSC2 Type changed to:', osc2Type.value);
            const isDX7 = osc2Type.value === 'dx7';
            const container = document.getElementById('osc2DX7Container');
            if (container) {
                container.style.display = isDX7 ? 'block' : 'none';
            }
            if (isDX7) {
                console.log('   Calling initializeDX7UI(2)...');
                initializeDX7UI(2);
            }
        });
        console.log('✅ OSC2 type change listener added');
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    setupOscillatorTypeListeners();
});
