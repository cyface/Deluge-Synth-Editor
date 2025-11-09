// Deluge Synth Editor - XML Engine
// XML generation, parsing, and file send/load functions

// ============================================================================
// SEND PRESET TO DELUGE
// ============================================================================

async function sendToDeluge() {
    if (!delugeOutput) {
        showNotification('✗ Not connected to Deluge', true);
        return;
    }

    const xml = generateXML();
    const presetName = document.getElementById('presetName').value || 'My Synth';
    // Keep spaces, only remove characters that are invalid in filenames
    const filename = presetName.replace(/[\/\\:*?"<>|]/g, '_').toUpperCase() + '.XML';
    
    // Determine target filepath
    let filepath;
    let dirPath = '/SYNTHS/';
    
    if (originalLoadedFilepath) {
        // Extract original directory path
        const originalDir = originalLoadedFilepath.substring(0, originalLoadedFilepath.lastIndexOf('/') + 1);
        const originalFilename = originalLoadedFilepath.substring(originalLoadedFilepath.lastIndexOf('/') + 1);
        
        // Check if name has changed
        const nameChanged = originalFilename.toUpperCase() !== filename;
        
        if (nameChanged) {
            // Name changed - save to root /SYNTHS/ as a new file
            filepath = '/SYNTHS/' + filename;
        } else {
            // Name unchanged - save back to original location
            filepath = originalLoadedFilepath;
            dirPath = originalDir;
        }
    } else {
        // No original file - save to root /SYNTHS/
        filepath = '/SYNTHS/' + filename;
    }

    try {
        // Always check if file exists and ask for confirmation
        showNotification('📤 Checking file...');
        const exists = await fileExists(filepath);
        
        if (exists) {
            // File exists - ask for confirmation
            const overwrite = confirm(
                `"${filename}" already exists at ${dirPath}\n\n` +
                `Click OK to overwrite.\n` +
                `Click Cancel to abort.\n\n` +
                `Tip: Change the preset name to save as a new file.`
            );
            
            if (!overwrite) {
                showNotification('✗ Save cancelled', true);
                return;
            }
        }
        
        showNotification('📤 Sending to Deluge...');
        await writeFile(filepath, xml);
        
        // Send popup notification to Deluge (shows "HELLO SYSEX")
        sendPopupNotification();
        
        // Update the original filepath tracker
        originalLoadedFilepath = filepath;
        
        // Update save path indicator for next save
        updateSavePathIndicator();
        
        showNotification(`✓ Saved to ${filepath} - Reload patch on Deluge to hear changes`);
    } catch (error) {
        console.error('Error sending to Deluge:', error);
        showNotification('✗ Failed: ' + error.message, true);
    }
}

// ============================================================================
// XML GENERATION
// ============================================================================

function syncUIToState() {
    // Sync all select/input elements to state
    const inputs = document.querySelectorAll('select, input[type="number"], input[type="text"]');
    inputs.forEach(input => {
        if (input.id && input.id !== 'presetName' && input.id !== 'xmlFileInput') {
            currentState[input.id] = input.value;
        }
    });
}

function generateXML() {
    syncUIToState();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<sound';

    // Add firmware version as attributes for modern format
    xml += '\n\tfirmwareVersion="c1.3.0"';
    xml += '\n\tearliestCompatibleFirmware="4.1.0-alpha"';
    xml += `\n\tpolyphonic="${currentState.polyphonic}"`;
    xml += `\n\tvoicePriority="${currentState.voicePriority}"`;
    
    // Optional sidechain send level
    if (currentState.sidechainSend && currentState.sidechainSend !== '0') {
        xml += `\n\tsideChainSend="${currentState.sidechainSend}"`;
    }
    
    xml += `\n\tmode="${currentState.mode}"`;
    
    // Optional sound-level transpose
    if (currentState.transpose && currentState.transpose !== '0') {
        xml += `\n\ttranspose="${currentState.transpose}"`;
    }
    
    xml += `\n\tmodFXType="${currentState.modFXType}"`;
    xml += `\n\tlpfMode="${currentState.lpfMode}"`;
    if (currentState.hpfMode) xml += `\n\thpfMode="${currentState.hpfMode}"`;
    if (currentState.filterRoute) xml += `\n\tfilterRoute="${currentState.filterRoute}"`;
    
    // Optional clipping amount
    if (currentState.clippingAmount && currentState.clippingAmount !== '0') {
        xml += `\n\tclippingAmount="${currentState.clippingAmount}"`;
    }
    
    if (currentState.maxVoices !== '8') xml += `\n\tmaxVoices="${currentState.maxVoices}"`;
    xml += '>\n';

    // Oscillator 1
    xml += `\t<osc1\n\t\ttype="${currentState.osc1Type}"`;
    if (currentState.osc1IsTracking !== undefined && currentState.osc1IsTracking !== '1') {
        xml += `\n\t\tisTracking="${currentState.osc1IsTracking}"`;
    }
    xml += `\n\t\ttranspose="${currentState.osc1Transpose}"`;
    xml += `\n\t\tcents="${currentState.osc1Cents}"`;
    xml += `\n\t\tretrigPhase="${currentState.osc1RetrigPhase}"`;
    
    // Add fileName attribute if specified for sample/wavetable
    if (currentState.osc1File && (currentState.osc1Type === 'sample' || currentState.osc1Type === 'wavetable')) {
        xml += `\n\t\tfileName="${currentState.osc1File}"`;
    }
    
    // Add any pass-through attributes we don't have UI for
    for (const [key, value] of Object.entries(passThroughData.osc1Attributes)) {
        xml += `\n\t\t${key}="${value}"`;
    }
    
    xml += ' />\n';

    // Oscillator 2
    xml += `\t<osc2\n\t\ttype="${currentState.osc2Type}"`;
    if (currentState.osc2IsTracking !== undefined && currentState.osc2IsTracking !== '1') {
        xml += `\n\t\tisTracking="${currentState.osc2IsTracking}"`;
    }
    xml += `\n\t\ttranspose="${currentState.osc2Transpose}"`;
    xml += `\n\t\tcents="${currentState.osc2Cents}"`;
    if (currentState.osc2Sync === '1') {
        xml += `\n\t\toscillatorSync="${currentState.osc2Sync}"`;
    }
    xml += `\n\t\tretrigPhase="${currentState.osc2RetrigPhase}"`;
    
    // Add fileName attribute if specified for sample/wavetable
    if (currentState.osc2File && (currentState.osc2Type === 'sample' || currentState.osc2Type === 'wavetable')) {
        xml += `\n\t\tfileName="${currentState.osc2File}"`;
    }
    
    // Add any pass-through attributes we don't have UI for
    for (const [key, value] of Object.entries(passThroughData.osc2Attributes)) {
        xml += `\n\t\t${key}="${value}"`;
    }
    
    xml += ' />\n';

    // LFOs
    xml += `\t<lfo1 type="${currentState.lfo1Type}"`;
    xml += ` syncLevel="${currentState.lfo1SyncLevel}"`;
    xml += ` syncType="${currentState.lfo1SyncType}" />\n`;

    xml += `\t<lfo2 type="${currentState.lfo2Type}"`;
    if (currentState.lfo2SyncLevel !== '0') {
        xml += ` syncLevel="${currentState.lfo2SyncLevel}"`;
        xml += ` syncType="${currentState.lfo2SyncType}"`;
    }
    xml += ' />\n';
    
    // LFO3 and LFO4 (Community Firmware)
    xml += `\t<lfo3 type="${currentState.lfo3Type}"`;
    xml += ` syncLevel="${currentState.lfo3SyncLevel}"`;
    xml += ` syncType="${currentState.lfo3SyncType}" />\n`;
    
    xml += `\t<lfo4 type="${currentState.lfo4Type}"`;
    xml += ` syncLevel="${currentState.lfo4SyncLevel}"`;
    xml += ` syncType="${currentState.lfo4SyncType}" />\n`;

    // Unison
    xml += `\t<unison num="${currentState.unisonNum}"`;
    xml += ` detune="${currentState.unisonDetune}"`;
    if (currentState.unisonSpread !== '0') {
        xml += ` spread="${currentState.unisonSpread}"`;
    }
    xml += ' />\n';

    // Delay
    xml += `\t<delay\n\t\tpingPong="${currentState.delayPingPong}"`;
    xml += `\n\t\tanalog="${currentState.delayAnalog}"`;
    xml += `\n\t\tsyncLevel="${currentState.delaySyncLevel}"`;
    xml += `\n\t\tsyncType="${currentState.delaySyncType}" />\n`;

    // Sidechain (formerly compressor) - only write if non-default values
    const hasSidechain = currentState.sidechainSyncLevel !== '6' || 
                        currentState.sidechainSyncType !== '0' ||
                        currentState.sidechainAttack !== '327244' ||
                        currentState.sidechainRelease !== '936';
    
    if (hasSidechain) {
        xml += `\t<sidechain\n\t\tsyncLevel="${currentState.sidechainSyncLevel}"`;
        xml += `\n\t\tsyncType="${currentState.sidechainSyncType}"`;
        xml += `\n\t\tattack="${currentState.sidechainAttack}"`;
        xml += `\n\t\trelease="${currentState.sidechainRelease}" />\n`;
    }

    // Default parameters
    xml += '\t<defaultParams';
    xml += `\n\t\tarpeggiatorGate="${currentState.arpeggiatorGate}"`;
    xml += `\n\t\tportamento="${currentState.portamento}"`;
    xml += `\n\t\tcompressorShape="${currentState.compressorShape}"`;
    xml += `\n\t\toscAVolume="${currentState.oscAVolume}"`;
    xml += `\n\t\toscAPulseWidth="${currentState.oscAPulseWidth}"`;
    xml += `\n\t\toscAWavetablePosition="${currentState.oscAWavetablePosition}"`;
    xml += `\n\t\toscBVolume="${currentState.oscBVolume}"`;
    xml += `\n\t\toscBPulseWidth="${currentState.oscBPulseWidth}"`;
    xml += `\n\t\toscBWavetablePosition="${currentState.oscBWavetablePosition}"`;
    xml += `\n\t\tnoiseVolume="${currentState.noiseVolume}"`;
    xml += `\n\t\tvolume="${currentState.volume}"`;
    xml += `\n\t\tpan="${currentState.pan}"`;
    xml += `\n\t\tlpfFrequency="${currentState.lpfFrequency}"`;
    xml += `\n\t\tlpfResonance="${currentState.lpfResonance}"`;
    xml += `\n\t\tlpfMorph="${currentState.lpfMorph}"`;
    xml += `\n\t\thpfFrequency="${currentState.hpfFrequency}"`;
    xml += `\n\t\thpfResonance="${currentState.hpfResonance}"`;
    xml += `\n\t\thpfMorph="${currentState.hpfMorph}"`;
    xml += `\n\t\tlfo1Rate="${currentState.lfo1Rate}"`;
    xml += `\n\t\tlfo2Rate="${currentState.lfo2Rate}"`;
    xml += `\n\t\tlfo3Rate="${currentState.lfo3Rate}"`;
    xml += `\n\t\tlfo4Rate="${currentState.lfo4Rate}"`;
    xml += `\n\t\tmodulator1Amount="${currentState.modulator1Amount}"`;
    xml += `\n\t\tmodulator1Feedback="${currentState.modulator1Feedback}"`;
    xml += `\n\t\tmodulator2Amount="${currentState.modulator2Amount}"`;
    xml += `\n\t\tmodulator2Feedback="${currentState.modulator2Feedback}"`;
    xml += `\n\t\tcarrier1Feedback="${currentState.carrier1Feedback}"`;
    xml += `\n\t\tcarrier2Feedback="${currentState.carrier2Feedback}"`;
    xml += `\n\t\tmodFXRate="${currentState.modFXRate}"`;
    xml += `\n\t\tmodFXDepth="${currentState.modFXDepth}"`;
    xml += `\n\t\tdelayRate="${currentState.delayRate}"`;
    xml += `\n\t\tdelayFeedback="${currentState.delayFeedback}"`;
    xml += `\n\t\treverbAmount="${currentState.reverbAmount}"`;
    xml += `\n\t\tarpeggiatorRate="${currentState.arpeggiatorRate}"`;
    xml += `\n\t\tstutterRate="${currentState.stutterRate}"`;
    xml += `\n\t\tsampleRateReduction="${currentState.sampleRateReduction}"`;
    xml += `\n\t\tbitCrush="${currentState.bitCrush}"`;
    xml += `\n\t\tmodFXOffset="${currentState.modFXOffset}"`;
    xml += `\n\t\tmodFXFeedback="${currentState.modFXFeedback}"`;
    xml += `\n\t\twaveFold="${currentState.waveFold}">\n`;

    // Envelopes
    xml += `\t\t<envelope1\n\t\t\tattack="${currentState.env1Attack}"`;
    xml += `\n\t\t\tdecay="${currentState.env1Decay}"`;
    xml += `\n\t\t\tsustain="${currentState.env1Sustain}"`;
    xml += `\n\t\t\trelease="${currentState.env1Release}" />\n`;

    xml += `\t\t<envelope2\n\t\t\tattack="${currentState.env2Attack}"`;
    xml += `\n\t\t\tdecay="${currentState.env2Decay}"`;
    xml += `\n\t\t\tsustain="${currentState.env2Sustain}"`;
    xml += `\n\t\t\trelease="${currentState.env2Release}" />\n`;

    xml += `\t\t<envelope3\n\t\t\tattack="${currentState.env3Attack}"`;
    xml += `\n\t\t\tdecay="${currentState.env3Decay}"`;
    xml += `\n\t\t\tsustain="${currentState.env3Sustain}"`;
    xml += `\n\t\t\trelease="${currentState.env3Release}" />\n`;

    xml += `\t\t<envelope4\n\t\t\tattack="${currentState.env4Attack}"`;
    xml += `\n\t\t\tdecay="${currentState.env4Decay}"`;
    xml += `\n\t\t\tsustain="${currentState.env4Sustain}"`;
    xml += `\n\t\t\trelease="${currentState.env4Release}" />\n`;

    // Patch cables
    if (patchCables.length > 0) {
        xml += '\t\t<patchCables>\n';
        patchCables.forEach(cable => {
            xml += `\t\t\t<patchCable\n\t\t\t\tsource="${cable.source}"`;
            xml += `\n\t\t\t\tdestination="${cable.destination}"`;
            xml += `\n\t\t\t\tamount="${cable.amount}" />\n`;
        });
        xml += '\t\t</patchCables>\n';
    }

    // Equalizer
    xml += `\t\t<equalizer\n\t\t\tbass="${currentState.bass}"`;
    xml += `\n\t\t\ttreble="${currentState.treble}"`;
    xml += `\n\t\t\tbassFrequency="${currentState.bassFrequency}"`;
    xml += `\n\t\t\ttrebleFrequency="${currentState.trebleFrequency}" />\n`;

    xml += '\t</defaultParams>\n';

    // Arpeggiator (basic)
    xml += '\t<arpeggiator\n\t\tmode="off"';
    xml += '\n\t\tnumOctaves="2"';
    xml += `\n\t\tsyncLevel="7"`;
    xml += `\n\t\tsyncType="0" />\n`;

    // ModKnobs - basic default set
    xml += '\t<modKnobs>\n';
    const defaultModKnobs = [
        'pan', 'volumePostFX', 'lpfResonance', 'lpfFrequency',
        'env1Release', 'env1Attack', 'delayFeedback', 'delayRate',
        'reverbAmount', 'stutterRate'
    ];
    defaultModKnobs.forEach(param => {
        xml += `\t\t<modKnob controlsParam="${param}" />\n`;
    });
    xml += '\t</modKnobs>\n';

    xml += '</sound>\n';

    return xml;
}

function downloadXML() {
    // Generate and download XML in one step - silent, no notification
    const xml = generateXML();
    const presetName = document.getElementById('presetName').value || 'My Synth';
    // Keep spaces, only remove characters that are invalid in filenames
    const filename = presetName.replace(/[\/\\:*?"<>|]/g, '_') + '.XML';

    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================================================
// XML LOADING
// ============================================================================

function loadXML() {
    const input = document.getElementById('xmlFileInput');
    input.click();
}

document.getElementById('xmlFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            parseXML(event.target.result);
            // Clear original filepath since this is loaded from local file
            originalLoadedFilepath = null;
            updateSavePathIndicator();
            showNotification('✓ Preset loaded: ' + file.name);
        } catch (error) {
            showNotification('✗ Error loading XML: ' + error.message, true);
            console.error(error);
        }
    };
    reader.readAsText(file);
});

function parseXML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    const sound = xmlDoc.querySelector('sound');

    if (!sound) {
        throw new Error('Invalid Deluge synth XML file');
    }
    
    // Clear pass-through data for new file
    passThroughData = {
        soundAttributes: {},
        osc1Attributes: {},
        osc2Attributes: {},
        osc1SubTags: '',
        osc2SubTags: '',
        unknownTags: ''
    };

    // Parse attributes
    if (sound.hasAttribute('polyphonic')) currentState.polyphonic = sound.getAttribute('polyphonic');
    if (sound.hasAttribute('voicePriority')) currentState.voicePriority = sound.getAttribute('voicePriority');
    if (sound.hasAttribute('mode')) currentState.mode = sound.getAttribute('mode');
    if (sound.hasAttribute('lpfMode')) currentState.lpfMode = sound.getAttribute('lpfMode');
    if (sound.hasAttribute('hpfMode')) currentState.hpfMode = sound.getAttribute('hpfMode');
    if (sound.hasAttribute('modFXType')) currentState.modFXType = sound.getAttribute('modFXType');
    if (sound.hasAttribute('filterRoute')) currentState.filterRoute = sound.getAttribute('filterRoute');
    if (sound.hasAttribute('maxVoices')) currentState.maxVoices = sound.getAttribute('maxVoices');

    // Parse OSC1
    const osc1 = sound.querySelector('osc1');
    if (osc1) {
        if (osc1.querySelector('type')) currentState.osc1Type = osc1.querySelector('type').textContent;
        else if (osc1.hasAttribute('type')) currentState.osc1Type = osc1.getAttribute('type');

        if (osc1.querySelector('transpose')) currentState.osc1Transpose = osc1.querySelector('transpose').textContent;
        else if (osc1.hasAttribute('transpose')) currentState.osc1Transpose = osc1.getAttribute('transpose');

        if (osc1.querySelector('cents')) currentState.osc1Cents = osc1.querySelector('cents').textContent;
        else if (osc1.hasAttribute('cents')) currentState.osc1Cents = osc1.getAttribute('cents');

        if (osc1.querySelector('retrigPhase')) currentState.osc1RetrigPhase = osc1.querySelector('retrigPhase').textContent;
        else if (osc1.hasAttribute('retrigPhase')) currentState.osc1RetrigPhase = osc1.getAttribute('retrigPhase');
        
        if (osc1.hasAttribute('isTracking')) currentState.osc1IsTracking = osc1.getAttribute('isTracking');

        if (osc1.hasAttribute('fileName')) currentState.osc1File = osc1.getAttribute('fileName');
        
        // Store unknown attributes for pass-through
        const knownAttrs = ['type', 'transpose', 'cents', 'retrigPhase', 'isTracking', 'fileName'];
        for (const attr of osc1.attributes) {
            if (!knownAttrs.includes(attr.name)) {
                passThroughData.osc1Attributes[attr.name] = attr.value;
            }
        }
    }

    // Parse OSC2
    const osc2 = sound.querySelector('osc2');
    if (osc2) {
        if (osc2.querySelector('type')) currentState.osc2Type = osc2.querySelector('type').textContent;
        else if (osc2.hasAttribute('type')) currentState.osc2Type = osc2.getAttribute('type');

        if (osc2.querySelector('transpose')) currentState.osc2Transpose = osc2.querySelector('transpose').textContent;
        else if (osc2.hasAttribute('transpose')) currentState.osc2Transpose = osc2.getAttribute('transpose');

        if (osc2.querySelector('cents')) currentState.osc2Cents = osc2.querySelector('cents').textContent;
        else if (osc2.hasAttribute('cents')) currentState.osc2Cents = osc2.getAttribute('cents');

        if (osc2.querySelector('retrigPhase')) currentState.osc2RetrigPhase = osc2.querySelector('retrigPhase').textContent;
        else if (osc2.hasAttribute('retrigPhase')) currentState.osc2RetrigPhase = osc2.getAttribute('retrigPhase');
        
        if (osc2.hasAttribute('isTracking')) currentState.osc2IsTracking = osc2.getAttribute('isTracking');

        if (osc2.querySelector('oscillatorSync')) currentState.osc2Sync = osc2.querySelector('oscillatorSync').textContent;
        else if (osc2.hasAttribute('oscillatorSync')) currentState.osc2Sync = osc2.getAttribute('oscillatorSync');

        if (osc2.hasAttribute('fileName')) currentState.osc2File = osc2.getAttribute('fileName');
        
        // Store unknown attributes for pass-through
        const knownAttrs = ['type', 'transpose', 'cents', 'retrigPhase', 'isTracking', 'oscillatorSync', 'fileName'];
        for (const attr of osc2.attributes) {
            if (!knownAttrs.includes(attr.name)) {
                passThroughData.osc2Attributes[attr.name] = attr.value;
            }
        }
    }

    // Parse LFOs
    const lfo1 = sound.querySelector('lfo1');
    if (lfo1) {
        if (lfo1.querySelector('type')) currentState.lfo1Type = lfo1.querySelector('type').textContent;
        else if (lfo1.hasAttribute('type')) currentState.lfo1Type = lfo1.getAttribute('type');

        if (lfo1.querySelector('syncLevel')) currentState.lfo1SyncLevel = lfo1.querySelector('syncLevel').textContent;
        else if (lfo1.hasAttribute('syncLevel')) currentState.lfo1SyncLevel = lfo1.getAttribute('syncLevel');

        if (lfo1.hasAttribute('syncType')) currentState.lfo1SyncType = lfo1.getAttribute('syncType');
    }

    const lfo2 = sound.querySelector('lfo2');
    if (lfo2) {
        if (lfo2.querySelector('type')) currentState.lfo2Type = lfo2.querySelector('type').textContent;
        else if (lfo2.hasAttribute('type')) currentState.lfo2Type = lfo2.getAttribute('type');

        if (lfo2.hasAttribute('syncLevel')) currentState.lfo2SyncLevel = lfo2.getAttribute('syncLevel');
        if (lfo2.hasAttribute('syncType')) currentState.lfo2SyncType = lfo2.getAttribute('syncType');
    }
    
    // Parse LFO3 (Community Firmware)
    const lfo3 = sound.querySelector('lfo3');
    if (lfo3) {
        if (lfo3.querySelector('type')) currentState.lfo3Type = lfo3.querySelector('type').textContent;
        else if (lfo3.hasAttribute('type')) currentState.lfo3Type = lfo3.getAttribute('type');

        if (lfo3.hasAttribute('syncLevel')) currentState.lfo3SyncLevel = lfo3.getAttribute('syncLevel');
        if (lfo3.hasAttribute('syncType')) currentState.lfo3SyncType = lfo3.getAttribute('syncType');
    }
    
    // Parse LFO4 (Community Firmware)
    const lfo4 = sound.querySelector('lfo4');
    if (lfo4) {
        if (lfo4.querySelector('type')) currentState.lfo4Type = lfo4.querySelector('type').textContent;
        else if (lfo4.hasAttribute('type')) currentState.lfo4Type = lfo4.getAttribute('type');

        if (lfo4.hasAttribute('syncLevel')) currentState.lfo4SyncLevel = lfo4.getAttribute('syncLevel');
        if (lfo4.hasAttribute('syncType')) currentState.lfo4SyncType = lfo4.getAttribute('syncType');
    }

    // Parse unison
    const unison = sound.querySelector('unison');
    if (unison) {
        if (unison.querySelector('num')) currentState.unisonNum = unison.querySelector('num').textContent;
        else if (unison.hasAttribute('num')) currentState.unisonNum = unison.getAttribute('num');

        if (unison.querySelector('detune')) currentState.unisonDetune = unison.querySelector('detune').textContent;
        else if (unison.hasAttribute('detune')) currentState.unisonDetune = unison.getAttribute('detune');

        if (unison.hasAttribute('spread')) currentState.unisonSpread = unison.getAttribute('spread');
    }

    // Parse delay
    const delay = sound.querySelector('delay');
    if (delay) {
        if (delay.querySelector('pingPong')) currentState.delayPingPong = delay.querySelector('pingPong').textContent;
        else if (delay.hasAttribute('pingPong')) currentState.delayPingPong = delay.getAttribute('pingPong');

        if (delay.querySelector('analog')) currentState.delayAnalog = delay.querySelector('analog').textContent;
        else if (delay.hasAttribute('analog')) currentState.delayAnalog = delay.getAttribute('analog');

        if (delay.querySelector('syncLevel')) currentState.delaySyncLevel = delay.querySelector('syncLevel').textContent;
        else if (delay.hasAttribute('syncLevel')) currentState.delaySyncLevel = delay.getAttribute('syncLevel');

        if (delay.hasAttribute('syncType')) currentState.delaySyncType = delay.getAttribute('syncType');
    }

    // Parse sidechain/compressor
    const sidechain = sound.querySelector('sidechain, compressor');
    if (sidechain) {
        if (sidechain.hasAttribute('syncLevel')) currentState.sidechainSyncLevel = sidechain.getAttribute('syncLevel');
        if (sidechain.hasAttribute('syncType')) currentState.sidechainSyncType = sidechain.getAttribute('syncType');
        if (sidechain.hasAttribute('attack')) currentState.sidechainAttack = sidechain.getAttribute('attack');
        if (sidechain.hasAttribute('release')) currentState.sidechainRelease = sidechain.getAttribute('release');
    }

    // Parse default params
    const defaultParams = sound.querySelector('defaultParams');
    if (defaultParams) {
        // Parse all hex parameters
        const hexParams = [
            'arpeggiatorGate', 'portamento', 'compressorShape',
            'oscAVolume', 'oscAPulseWidth', 'oscAWavetablePosition',
            'oscBVolume', 'oscBPulseWidth', 'oscBWavetablePosition',
            'noiseVolume', 'volume', 'pan',
            'lpfFrequency', 'lpfResonance', 'lpfMorph',
            'hpfFrequency', 'hpfResonance', 'hpfMorph',
            'lfo1Rate', 'lfo2Rate', 'lfo3Rate', 'lfo4Rate',
            'modulator1Amount', 'modulator1Feedback',
            'modulator2Amount', 'modulator2Feedback',
            'carrier1Feedback', 'carrier2Feedback',
            'modFXRate', 'modFXDepth', 'modFXOffset', 'modFXFeedback',
            'delayRate', 'delayFeedback', 'reverbAmount', 'arpeggiatorRate',
            'stutterRate', 'sampleRateReduction', 'bitCrush', 'waveFold'
        ];

        hexParams.forEach(param => {
            if (defaultParams.hasAttribute(param)) {
                currentState[param] = defaultParams.getAttribute(param);
            }
        });

        // Parse envelopes
        const env1 = defaultParams.querySelector('envelope1');
        if (env1) {
            if (env1.hasAttribute('attack')) currentState.env1Attack = env1.getAttribute('attack');
            if (env1.hasAttribute('decay')) currentState.env1Decay = env1.getAttribute('decay');
            if (env1.hasAttribute('sustain')) currentState.env1Sustain = env1.getAttribute('sustain');
            if (env1.hasAttribute('release')) currentState.env1Release = env1.getAttribute('release');
        }

        const env2 = defaultParams.querySelector('envelope2');
        if (env2) {
            if (env2.hasAttribute('attack')) currentState.env2Attack = env2.getAttribute('attack');
            if (env2.hasAttribute('decay')) currentState.env2Decay = env2.getAttribute('decay');
            if (env2.hasAttribute('sustain')) currentState.env2Sustain = env2.getAttribute('sustain');
            if (env2.hasAttribute('release')) currentState.env2Release = env2.getAttribute('release');
        }

        const env3 = defaultParams.querySelector('envelope3');
        if (env3) {
            if (env3.hasAttribute('attack')) currentState.env3Attack = env3.getAttribute('attack');
            if (env3.hasAttribute('decay')) currentState.env3Decay = env3.getAttribute('decay');
            if (env3.hasAttribute('sustain')) currentState.env3Sustain = env3.getAttribute('sustain');
            if (env3.hasAttribute('release')) currentState.env3Release = env3.getAttribute('release');
        }

        const env4 = defaultParams.querySelector('envelope4');
        if (env4) {
            if (env4.hasAttribute('attack')) currentState.env4Attack = env4.getAttribute('attack');
            if (env4.hasAttribute('decay')) currentState.env4Decay = env4.getAttribute('decay');
            if (env4.hasAttribute('sustain')) currentState.env4Sustain = env4.getAttribute('sustain');
            if (env4.hasAttribute('release')) currentState.env4Release = env4.getAttribute('release');
        }

        // Parse patch cables
        patchCables = [];
        const patchCableElements = defaultParams.querySelectorAll('patchCables > patchCable');
        patchCableElements.forEach(cable => {
            patchCables.push({
                source: cable.getAttribute('source'),
                destination: cable.getAttribute('destination'),
                amount: cable.getAttribute('amount')
            });
        });

        // Parse equalizer
        const equalizer = defaultParams.querySelector('equalizer');
        if (equalizer) {
            if (equalizer.hasAttribute('bass')) currentState.bass = equalizer.getAttribute('bass');
            if (equalizer.hasAttribute('treble')) currentState.treble = equalizer.getAttribute('treble');
            if (equalizer.hasAttribute('bassFrequency')) currentState.bassFrequency = equalizer.getAttribute('bassFrequency');
            if (equalizer.hasAttribute('trebleFrequency')) currentState.trebleFrequency = equalizer.getAttribute('trebleFrequency');
        }
    }

    // Update UI with loaded values
    updateUIFromState();
}

function updateUIFromState() {
    // Update all form elements
    Object.keys(currentState).forEach(key => {
        const element = document.getElementById(key);
        if (element) {
            element.value = currentState[key];
        }
    });

    // Update all knobs
    const knobs = document.querySelectorAll('.knob');
    knobs.forEach(knob => {
        const paramName = knob.dataset.param;
        const min = parseFloat(knob.dataset.min);
        const max = parseFloat(knob.dataset.max);

        if (currentState[paramName]) {
            const uiValue = hexToUI(currentState[paramName], min, max);
            updateKnobDisplay(knob, uiValue, min, max);
        }
    });

    // Update patch cables display
    renderPatchCables();
}

function resetToDefault() {
    if (confirm('Reset all parameters to default values?')) {
        currentState = { ...defaultParams };
        patchCables = [];
        originalLoadedFilepath = null; // Clear since we're starting fresh
        
        // Clear pass-through data
        passThroughData = {
            soundAttributes: {},
            osc1Attributes: {},
            osc2Attributes: {},
            osc1SubTags: '',
            osc2SubTags: '',
            unknownTags: ''
        };
        
        updateUIFromState();
        updateSavePathIndicator();
        showNotification('✓ Reset to default values');
    }
}

