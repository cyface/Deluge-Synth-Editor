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

