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
// INITIALIZATION
// ============================================================================

/**
 * Safety net for control groups added without a for= on their label: associate
 * the label with the group's field so screen readers announce it. The static
 * markup already carries for= everywhere (DevTools' audit runs at parse time,
 * so runtime fixes don't silence it - keep new markup labeled statically).
 */
function associateControlLabels(root = document) {
    root.querySelectorAll('.control-group').forEach(group => {
        const label = group.querySelector('label.control-label');
        if (!label || label.htmlFor) return;
        const field = group.querySelector('input, select, textarea');
        if (!field) return;
        if (field.id) {
            label.htmlFor = field.id;
        } else if (!field.hasAttribute('aria-label')) {
            field.setAttribute('aria-label', label.textContent.trim());
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initializeKnobs();
    renderPatchCables();
    associateControlLabels();

    // Initialize envelope canvases (values match what the defaults resolve to)
    drawEnvelope('env1Canvas', 0, 20, 50, 1, 0, 50);
    drawEnvelope('env2Canvas', 20, 20, 25, 20, 0, 50);
    drawEnvelope('env3Canvas', 20, 20, 25, 20, 0, 50);
    drawEnvelope('env4Canvas', 20, 20, 25, 20, 0, 50);

    // Add change listeners to all inputs to update state
    const inputs = document.querySelectorAll('select, input[type="number"], input[type="text"], input[type="range"]');
    inputs.forEach(input => {
        // Patch cable / mod knob controls have ids (for their labels) but are
        // not synth parameters - they manage their own state in their renderers
        if (input.closest('#patchCablesContainer, #modKnobsContainer')) return;
        if (input.id && input.id !== 'presetName' && input.id !== 'xmlFileInput') {
            // Sliders need 'input' too, so the readout tracks the drag rather
            // than only updating once the user lets go.
            const event = input.type === 'range' ? 'input' : 'change';
            input.addEventListener(event, () => {
                currentState[input.id] = readInputValue(input);

                // Redraw envelopes if envelope parameter changed
                if (input.id.startsWith('env')) {
                    const envNum = input.id.charAt(3); // Get envelope number (1-4)
                    updateEnvelopeDisplay(envNum);
                }

                if (sliderReadouts[input.id]) {
                    updateSliderReadout(input.id);
                }

                // Syncing LFO1/LFO3 makes their rates unmodulatable
                // (patchCableProblem), so refresh the cable warnings.
                if (input.id === 'lfo1SyncLevel' || input.id === 'lfo3SyncLevel') {
                    renderPatchCables();
                }
            });
        }
    });

    renderModKnobs();
    Object.keys(sliderReadouts).forEach(updateSliderReadout);

});

