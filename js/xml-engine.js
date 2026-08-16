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
    let dirPath;
    
    if (originalLoadedFilepath) {
        // Extract original directory path
        const originalDir = originalLoadedFilepath.substring(0, originalLoadedFilepath.lastIndexOf('/') + 1);
        const originalFilename = originalLoadedFilepath.substring(originalLoadedFilepath.lastIndexOf('/') + 1);
        
        // Always save to the original directory (even if renamed)
        filepath = originalDir + filename;
        dirPath = originalDir;
    } else {
        // No original file - use selected save directory
        const saveDir = document.getElementById('saveDirectory').value || '/SYNTHS/';
        filepath = saveDir + filename;
        dirPath = saveDir;
    }

    try {
        // Check if file exists first (before showing modal)
        showCommIndicator();
        const exists = await fileExists(filepath);
        hideCommIndicator();
        
        if (exists) {
            // File exists - ask for confirmation
            const overwrite = confirm(
                `⚠️ "${filename}" already exists at ${dirPath}\n\n` +
                `Click OK to OVERWRITE the existing file.\n` +
                `Click Cancel to abort.\n\n` +
                `Tip: Change the preset name to save as a new file.`
            );
            
            if (!overwrite) {
                showNotification('✗ Save cancelled', true);
                return;
            }
        }
        
        // Now proceed with the write
        showNotification('📤 Sending to Deluge...');
        await writeFile(filepath, xml);
        
        // Send popup notification to Deluge (shows "HELLO SYSEX")
        sendPopupNotification();
        
        // Update the original filepath tracker
        originalLoadedFilepath = filepath;
        
        // Update save path indicator for next save
        updateSavePathIndicator();
        
        // A plain re-load on the Deluge revives the stale in-memory copy (it
        // matches presets by name+folder, including hibernating ones). The
        // load browser's hold-press CLONE option re-reads the file from card.
        showNotification(`✓ Saved to ${filepath} - to hear changes on the Deluge: LOAD, hold the preset, choose CLONE`);
    } catch (error) {
        hideCommIndicator();
        console.error('Error sending to Deluge:', error);
        showNotification('✗ Failed: ' + error.message, true);
    }
}

// ============================================================================
// RETRIG PHASE CONVERSION
// ============================================================================

// The firmware stores retrig phase as degrees * (2^32/360), serialized
// through a signed-int32 writer: OFF is -1 (0xFFFFFFFF) and phases above
// 180 degrees appear as other negative numbers. Its own menu divides by
// 11930464 to show degrees (osc/retrigger_phase.h). The editor keeps
// degrees (-1..360) in state and converts at the XML boundary.
const RETRIG_PHASE_PER_DEGREE = 11930464;

function retrigPhaseToDegrees(value) {
    const n = parseInt(value);
    if (isNaN(n) || n === -1) return '-1';
    if (n >= 0 && n <= 360) return String(n); // already degrees (older editor-written file)
    const raw = n < 0 ? n + 4294967296 : n;
    return String(Math.round(raw / RETRIG_PHASE_PER_DEGREE));
}

function degreesToRetrigPhase(value) {
    const n = parseInt(value);
    if (isNaN(n) || n < 0) return '-1';
    let raw = Math.min(n, 360) * RETRIG_PHASE_PER_DEGREE;
    if (raw > 2147483647) raw -= 4294967296; // match the firmware's signed writer
    return String(raw);
}

// ============================================================================
// SIDECHAIN ATTACK/RELEASE CONVERSION
// ============================================================================

// Sidechain attack/release are stored raw in the XML but shown on the Deluge
// as a 0-50 index into exponential rate tables (menu_item/sidechain/attack.h
// and release.h; tables in lookuptables.cpp). raw = table[index] << shift,
// with shift 2 for attack and 3 for release. Reading picks the nearest table
// entry, matching the firmware's getLookupIndexFromValue().
const SIDECHAIN_ATTACK_TABLE = [
    262144, 221969, 187951, 159147, 134757, 114105, 96618, 81811,
    69273, 58656, 49667, 42055, 35610, 30153, 25532, 21619,
    18306, 15500, 13125, 11113, 9410, 7968, 6747, 5713,
    4837, 4096, 3468, 2937, 2487, 2106, 1783, 1510,
    1278, 1082, 917, 776, 657, 556, 471, 399,
    338, 286, 242, 205, 174, 147, 124, 105,
    89, 76, 64];
const SIDECHAIN_RELEASE_TABLE = [
    32691, 4604, 2444, 1648, 1234, 980, 809, 685,
    592, 519, 460, 412, 372, 338, 309, 283,
    261, 241, 224, 208, 194, 181, 169, 159,
    149, 140, 132, 124, 117, 110, 104, 98,
    93, 88, 83, 78, 74, 70, 66, 62,
    59, 56, 53, 50, 47, 44, 41, 39,
    36, 34, 32];

function sidechainRawToIndex(value, table, shift) {
    const n = parseInt(value);
    if (isNaN(n) || n < 0) return '0';
    if (n <= 50) return String(n); // already an index (raw values are always >= 256)
    const scaled = n >> shift;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < table.length; i++) {
        const distance = Math.abs(scaled - table[i]);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
        }
    }
    return String(best);
}

function sidechainIndexToRaw(value, table, shift) {
    const n = Math.min(50, Math.max(0, parseInt(value) || 0));
    return String(table[n] << shift);
}

// ============================================================================
// XML GENERATION
// ============================================================================

function syncUIToState() {
    // Sync all select/input elements to state. Range inputs carry the audio
    // compressor's raw knob positions, so they hold the file value directly
    // rather than a percentage - no conversion, no rounding drift.
    const inputs = document.querySelectorAll('select, input[type="number"], input[type="text"], input[type="range"]');
    inputs.forEach(input => {
        if (input.id && input.id !== 'presetName' && input.id !== 'xmlFileInput') {
            currentState[input.id] = readInputValue(input);
        }
    });
}

// Serialize an element back to XML text, indented to `depth` tabs. Used to
// replay tags the editor has no UI for. Attribute order and whitespace may
// differ from the source file, but no values are lost.
function serializeElement(el, depth) {
    const pad = '\t'.repeat(depth);
    let out = pad + '<' + el.tagName;

    for (const attr of el.attributes) {
        out += '\n' + pad + '\t' + attr.name + '="' + attr.value + '"';
    }

    const children = [...el.children];
    if (children.length === 0) {
        // Old-format files store values as tag text rather than attributes.
        const text = el.textContent.trim();
        return text ? out + '>' + text + '</' + el.tagName + '>\n' : out + ' />\n';
    }

    out += '>\n';
    children.forEach(child => {
        out += serializeElement(child, depth + 1);
    });
    return out + pad + '</' + el.tagName + '>\n';
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
    xml += `\n\thpfMode="${currentState.hpfMode}"`;
    xml += `\n\tfilterRoute="${currentState.filterRoute}"`;
    
    // Optional clipping amount
    if (currentState.clippingAmount && currentState.clippingAmount !== '0') {
        xml += `\n\tclippingAmount="${currentState.clippingAmount}"`;
    }
    
    // The Deluge writes maxVoices unconditionally, so match it - omitting the
    // default silently dropped the attribute when re-saving a Deluge preset.
    xml += `\n\tmaxVoices="${currentState.maxVoices}"`;

    // Replay <sound> attributes we have no UI for
    for (const [key, value] of Object.entries(passThroughData.soundAttributes)) {
        xml += `\n\t${key}="${value}"`;
    }

    xml += '>\n';

    // Oscillator 1
    xml += `\t<osc1\n\t\ttype="${currentState.osc1Type}"`;
    if (currentState.osc1IsTracking !== undefined && currentState.osc1IsTracking !== '1') {
        xml += `\n\t\tisTracking="${currentState.osc1IsTracking}"`;
    }
    xml += `\n\t\ttranspose="${currentState.osc1Transpose}"`;
    xml += `\n\t\tcents="${currentState.osc1Cents}"`;
    xml += `\n\t\tretrigPhase="${degreesToRetrigPhase(currentState.osc1RetrigPhase)}"`;
    
    // Add fileName attribute if specified for sample/wavetable
    if (currentState.osc1File && (currentState.osc1Type === 'sample' || currentState.osc1Type === 'wavetable')) {
        xml += `\n\t\tfileName="${currentState.osc1File}"`;
    }
    
    // Add DX7 attributes if type is dx7
    if (currentState.osc1Type === 'dx7') {
        
        if (currentState.osc1DX7Patch) {
            // Normalize to the 156-byte uppercase form the firmware writes
            // (155-byte patches from older files gain the operator-enable byte)
            xml += `\n\t\tdx7patch="${normalizeDX7PatchHex(currentState.osc1DX7Patch) || currentState.osc1DX7Patch}"`;
            if (currentState.osc1DX7EngineMode && currentState.osc1DX7EngineMode !== '0') {
                xml += `\n\t\tdx7enginemode="${currentState.osc1DX7EngineMode}"`;
            }
            if (currentState.osc1DX7RandomDetune && currentState.osc1DX7RandomDetune !== '0') {
                xml += `\n\t\tdx7randomdetune="${currentState.osc1DX7RandomDetune}"`;
            }
        } else {
            console.error('❌ OSC1 type is dx7 but no patch data found!');
        }
    }
    
    // Add any pass-through attributes we don't have UI for
    for (const [key, value] of Object.entries(passThroughData.osc1Attributes)) {
        xml += `\n\t\t${key}="${value}"`;
    }

    // Sub-tags like <zone> / <sampleRanges> have no UI - replay them verbatim
    if (passThroughData.osc1SubTags) {
        xml += '>\n' + passThroughData.osc1SubTags + '\t</osc1>\n';
    } else {
        xml += ' />\n';
    }

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
    xml += `\n\t\tretrigPhase="${degreesToRetrigPhase(currentState.osc2RetrigPhase)}"`;
    
    // Add fileName attribute if specified for sample/wavetable
    if (currentState.osc2File && (currentState.osc2Type === 'sample' || currentState.osc2Type === 'wavetable')) {
        xml += `\n\t\tfileName="${currentState.osc2File}"`;
    }
    
    // Add DX7 attributes if type is dx7
    if (currentState.osc2Type === 'dx7') {
        
        if (currentState.osc2DX7Patch) {
            xml += `\n\t\tdx7patch="${normalizeDX7PatchHex(currentState.osc2DX7Patch) || currentState.osc2DX7Patch}"`;
            if (currentState.osc2DX7EngineMode && currentState.osc2DX7EngineMode !== '0') {
                xml += `\n\t\tdx7enginemode="${currentState.osc2DX7EngineMode}"`;
            }
            if (currentState.osc2DX7RandomDetune && currentState.osc2DX7RandomDetune !== '0') {
                xml += `\n\t\tdx7randomdetune="${currentState.osc2DX7RandomDetune}"`;
            }
        } else {
            console.error('❌ OSC2 type is dx7 but no patch data found!');
        }
    }
    
    // Add any pass-through attributes we don't have UI for
    for (const [key, value] of Object.entries(passThroughData.osc2Attributes)) {
        xml += `\n\t\t${key}="${value}"`;
    }

    if (passThroughData.osc2SubTags) {
        xml += '>\n' + passThroughData.osc2SubTags + '\t</osc2>\n';
    } else {
        xml += ' />\n';
    }

    // LFOs
    xml += `\t<lfo1 type="${currentState.lfo1Type}"`;
    xml += ` syncLevel="${currentState.lfo1SyncLevel}"`;
    xml += ` syncType="${currentState.lfo1SyncType}" />\n`;

    // Written unconditionally like lfo1/3/4 - skipping them at the default value
    // dropped the attributes when re-saving a Deluge preset.
    xml += `\t<lfo2 type="${currentState.lfo2Type}"`;
    xml += ` syncLevel="${currentState.lfo2SyncLevel}"`;
    xml += ` syncType="${currentState.lfo2SyncType}" />\n`;
    
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
    xml += ` spread="${currentState.unisonSpread}" />\n`;

    // Delay
    xml += `\t<delay\n\t\tpingPong="${currentState.delayPingPong}"`;
    xml += `\n\t\tanalog="${currentState.delayAnalog}"`;
    xml += `\n\t\tsyncLevel="${currentState.delaySyncLevel}"`;
    xml += `\n\t\tsyncType="${currentState.delaySyncType}" />\n`;

    // Sidechain (formerly compressor) - only write if non-default values
    // Also write it back if the source file had one, even at default values -
    // otherwise re-saving a Deluge preset silently removes its <sidechain>.
    const hasSidechain = passThroughData.hadSidechain ||
                        currentState.sidechainSyncLevel !== '6' ||
                        currentState.sidechainSyncType !== '0' ||
                        currentState.sidechainAttack !== '7' ||
                        currentState.sidechainRelease !== '28';

    if (hasSidechain) {
        xml += `\t<sidechain\n\t\tsyncLevel="${currentState.sidechainSyncLevel}"`;
        xml += `\n\t\tsyncType="${currentState.sidechainSyncType}"`;
        xml += `\n\t\tattack="${sidechainIndexToRaw(currentState.sidechainAttack, SIDECHAIN_ATTACK_TABLE, 2)}"`;
        xml += `\n\t\trelease="${sidechainIndexToRaw(currentState.sidechainRelease, SIDECHAIN_RELEASE_TABLE, 3)}" />\n`;
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
    xml += `\n\t\twaveFold="${currentState.waveFold}"`;

    // Replay <defaultParams> attributes we have no UI for (compressorThreshold,
    // the arpeggiator probability/spread set, and anything a newer firmware adds)
    for (const [key, value] of Object.entries(passThroughData.defaultParamsAttributes)) {
        xml += `\n\t\t${key}="${value}"`;
    }

    xml += '>\n';

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
            xml += `\n\t\t\t\tamount="${cable.amount}"`;

            // Only write polarity when the source file specified it. The firmware
            // picks a sensible default per modulation source otherwise, and we
            // have no UI to make a better choice than it does.
            if (cable.polarity) {
                xml += `\n\t\t\t\tpolarity="${cable.polarity}"`;
            }

            // Legacy attribute from files predating V3.2, replayed only if the
            // source file actually had it. It is NOT a polarity flag: the
            // firmware uses it to re-point the cable's destination at another
            // cable's depth (patch_cable_set.cpp:915-953), so emitting it by
            // default silently rewires every cable in the preset.
            if (cable.rangeAdjustable !== undefined) {
                xml += `\n\t\t\t\trangeAdjustable="${cable.rangeAdjustable}"`;
            }

            for (const [key, value] of Object.entries(cable.extraAttributes || {})) {
                xml += `\n\t\t\t\t${key}="${value}"`;
            }

            // <depthControlledBy> and friends
            if (cable.subTags) {
                xml += '>\n' + cable.subTags + '\t\t\t</patchCable>\n';
            } else {
                xml += ' />\n';
            }
        });
        xml += '\t\t</patchCables>\n';
    }

    // Equalizer
    xml += `\t\t<equalizer\n\t\t\tbass="${currentState.bass}"`;
    xml += `\n\t\t\ttreble="${currentState.treble}"`;
    xml += `\n\t\t\tbassFrequency="${currentState.bassFrequency}"`;
    xml += `\n\t\t\ttrebleFrequency="${currentState.trebleFrequency}" />\n`;

    // Replay <defaultParams> sub-tags we have no UI for
    if (passThroughData.defaultParamsTags) {
        xml += passThroughData.defaultParamsTags;
    }

    xml += '\t</defaultParams>\n';

    // Arpeggiator. "mode" duplicates "arpMode" because that is what the Deluge
    // writes; current firmware reads arpMode and ignores mode entirely unless
    // the file declares a firmware below c1.1.0.
    xml += '\t<arpeggiator';
    xml += `\n\t\tmode="${currentState.arpMode}"`;
    xml += `\n\t\tsyncLevel="${currentState.arpSyncLevel}"`;
    xml += `\n\t\tnumOctaves="${currentState.arpNumOctaves}"`;
    xml += `\n\t\tsyncType="${currentState.arpSyncType}"`;
    xml += `\n\t\tarpMode="${currentState.arpMode}"`;
    xml += `\n\t\tchordType="${currentState.arpChordType}"`;
    xml += `\n\t\tnoteMode="${currentState.arpNoteMode}"`;
    xml += `\n\t\toctaveMode="${currentState.arpOctaveMode}"`;
    xml += `\n\t\tmpeVelocity="${currentState.arpMpeVelocity}"`;
    xml += `\n\t\tstepRepeat="${currentState.arpStepRepeat}"`;
    xml += `\n\t\trandomizerLock="${currentState.arpRandomizerLock}"`;
    xml += `\n\t\tkitArp="${currentState.arpKitArp}"`;

    // Replay the locked probability arrays, notePattern and anything else we
    // have no UI for, so a randomizer-locked arp survives a round trip.
    for (const [key, value] of Object.entries(passThroughData.arpeggiatorAttributes || {})) {
        xml += `\n\t\t${key}="${value}"`;
    }
    xml += ' />\n';

    // Gold knob assignments. Position in the list is what binds an entry to a
    // knob, so always write the full 16 - a short list would shift every
    // assignment after the gap onto the wrong knob.
    xml += '\t<modKnobs>\n';
    for (let i = 0; i < DEFAULT_MOD_KNOBS.length; i++) {
        const knob = modKnobs[i] || DEFAULT_MOD_KNOBS[i];
        xml += `\t\t<modKnob controlsParam="${knob.controlsParam}"`;
        if (knob.patchAmountFromSource) {
            xml += ` patchAmountFromSource="${knob.patchAmountFromSource}"`;
        }
        if (knob.patchAmountFromSecondSource) {
            xml += ` patchAmountFromSecondSource="${knob.patchAmountFromSecondSource}"`;
        }
        for (const [key, value] of Object.entries(passThroughData.modKnobExtras[i] || {})) {
            xml += ` ${key}="${value}"`;
        }
        xml += ' />\n';
    }
    xml += '\t</modKnobs>\n';

    // Replay whole elements we still don't recognize: <midiOutput> and whatever
    // a future firmware adds.
    if (passThroughData.unknownTags) {
        xml += passThroughData.unknownTags;
    }

    // Audio compressor and stutter config go last, after <midiOutput>, because
    // that is where the Deluge puts them - ModControllableAudio::writeTagsToFile
    // is called at the end of Sound::writeToFile (sound.cpp:4264). The reader
    // does not care about order, but matching it keeps diffs against
    // device-written files clean.
    //
    // Both are written unconditionally, again matching the firmware
    // (mod_controllable_audio.cpp:471-486). The defaults are inert, so writing
    // them into a preset that lacked them changes nothing.
    xml += `\t<audioCompressor\n\t\tattack="${currentState.compAttack}"`;
    xml += `\n\t\trelease="${currentState.compRelease}"`;
    xml += `\n\t\tthresh="${currentState.compThresh}"`;
    xml += `\n\t\tratio="${currentState.compRatio}"`;
    xml += `\n\t\tcompHPF="${currentState.compHPF}"`;
    xml += `\n\t\tcompBlend="${currentState.compBlend}" />\n`;

    xml += `\t<stutter\n\t\tquantized="${currentState.stutterQuantized}"`;
    xml += `\n\t\treverse="${currentState.stutterReverse}"`;
    xml += `\n\t\tpingPong="${currentState.stutterPingPong}" />\n`;

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
    
    // Handle factory format with multiple root elements
    // Extract just the <sound>...</sound> portion
    const soundMatch = xmlString.match(/<sound[\s\S]*<\/sound>/);
    if (soundMatch) {
        xmlString = '<?xml version="1.0" encoding="UTF-8"?>\n' + soundMatch[0];
    } else {
    }
    
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    
    // Check for XML parsing errors
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
        console.error('XML Parse Error:', parseError.textContent);
        throw new Error('XML parsing failed: ' + parseError.textContent);
    }
    
    const sound = xmlDoc.querySelector('sound');

    if (!sound) {
        console.error('No <sound> element found in XML');
        console.error('XML structure:', xmlDoc.documentElement.tagName);
        console.error('First 500 chars:', xmlString.substring(0, 500));
        throw new Error('Invalid Deluge synth XML file - no <sound> element found');
    }
    
    
    // Clear pass-through data for new file
    passThroughData = emptyPassThroughData();

    // Parse attributes
    if (sound.hasAttribute('polyphonic')) currentState.polyphonic = sound.getAttribute('polyphonic');
    if (sound.hasAttribute('voicePriority')) currentState.voicePriority = sound.getAttribute('voicePriority');
    if (sound.hasAttribute('mode')) currentState.mode = sound.getAttribute('mode');
    if (sound.hasAttribute('lpfMode')) currentState.lpfMode = sound.getAttribute('lpfMode');
    if (sound.hasAttribute('hpfMode')) currentState.hpfMode = sound.getAttribute('hpfMode');
    if (sound.hasAttribute('modFXType')) currentState.modFXType = sound.getAttribute('modFXType');
    if (sound.hasAttribute('filterRoute')) currentState.filterRoute = sound.getAttribute('filterRoute');
    if (sound.hasAttribute('maxVoices')) currentState.maxVoices = sound.getAttribute('maxVoices');

    // generateXML() writes these three, but nothing used to read them back, so a
    // sound-level transpose or sidechain send was lost on the round trip.
    if (sound.hasAttribute('transpose')) currentState.transpose = sound.getAttribute('transpose');
    if (sound.hasAttribute('sideChainSend')) currentState.sidechainSend = sound.getAttribute('sideChainSend');
    if (sound.hasAttribute('clippingAmount')) currentState.clippingAmount = sound.getAttribute('clippingAmount');

    // Keep any <sound> attribute we don't write ourselves
    for (const attr of sound.attributes) {
        if (!SOUND_ATTRIBUTES.includes(attr.name)) {
            passThroughData.soundAttributes[attr.name] = attr.value;
        }
    }

    // Keep whole elements we don't write ourselves (<modKnobs>, <midiOutput>,
    // <audioCompressor>, <stutter>, ...)
    for (const child of sound.children) {
        if (!SOUND_TAGS.includes(child.tagName)) {
            passThroughData.unknownTags += serializeElement(child, 1);
        }
    }

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
        currentState.osc1RetrigPhase = retrigPhaseToDegrees(currentState.osc1RetrigPhase);
        
        if (osc1.hasAttribute('isTracking')) currentState.osc1IsTracking = osc1.getAttribute('isTracking');

        if (osc1.hasAttribute('fileName')) currentState.osc1File = osc1.getAttribute('fileName');
        
        // Parse DX7 attributes
        if (osc1.hasAttribute('dx7patch')) currentState.osc1DX7Patch = osc1.getAttribute('dx7patch');
        if (osc1.hasAttribute('dx7enginemode')) currentState.osc1DX7EngineMode = osc1.getAttribute('dx7enginemode');
        if (osc1.hasAttribute('dx7randomdetune')) currentState.osc1DX7RandomDetune = osc1.getAttribute('dx7randomdetune');
        
        // Store unknown attributes for pass-through
        const knownAttrs = ['type', 'transpose', 'cents', 'retrigPhase', 'isTracking', 'fileName', 'dx7patch', 'dx7enginemode', 'dx7randomdetune'];
        for (const attr of osc1.attributes) {
            if (!knownAttrs.includes(attr.name)) {
                passThroughData.osc1Attributes[attr.name] = attr.value;
            }
        }

        // Sub-tags such as <zone> and <sampleRanges>. Skip the ones the parser
        // above already read as elements in old-format files, or they would be
        // written out twice.
        for (const child of osc1.children) {
            if (!OSC_VALUE_TAGS.includes(child.tagName)) {
                passThroughData.osc1SubTags += serializeElement(child, 2);
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
        currentState.osc2RetrigPhase = retrigPhaseToDegrees(currentState.osc2RetrigPhase);
        
        if (osc2.hasAttribute('isTracking')) currentState.osc2IsTracking = osc2.getAttribute('isTracking');

        if (osc2.querySelector('oscillatorSync')) currentState.osc2Sync = osc2.querySelector('oscillatorSync').textContent;
        else if (osc2.hasAttribute('oscillatorSync')) currentState.osc2Sync = osc2.getAttribute('oscillatorSync');

        if (osc2.hasAttribute('fileName')) currentState.osc2File = osc2.getAttribute('fileName');
        
        // Parse DX7 attributes
        if (osc2.hasAttribute('dx7patch')) currentState.osc2DX7Patch = osc2.getAttribute('dx7patch');
        if (osc2.hasAttribute('dx7enginemode')) currentState.osc2DX7EngineMode = osc2.getAttribute('dx7enginemode');
        if (osc2.hasAttribute('dx7randomdetune')) currentState.osc2DX7RandomDetune = osc2.getAttribute('dx7randomdetune');
        
        // Store unknown attributes for pass-through
        const knownAttrs = ['type', 'transpose', 'cents', 'retrigPhase', 'isTracking', 'oscillatorSync', 'fileName', 'dx7patch', 'dx7enginemode', 'dx7randomdetune'];
        for (const attr of osc2.attributes) {
            if (!knownAttrs.includes(attr.name)) {
                passThroughData.osc2Attributes[attr.name] = attr.value;
            }
        }

        for (const child of osc2.children) {
            if (!OSC_VALUE_TAGS.includes(child.tagName)) {
                passThroughData.osc2SubTags += serializeElement(child, 2);
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

    // Older editor versions wrote "sampleAndHold", which the firmware doesn't recognize; it writes "sah"
    for (const key of ['lfo1Type', 'lfo2Type', 'lfo3Type', 'lfo4Type']) {
        if (currentState[key] === 'sampleAndHold') currentState[key] = 'sah';
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
        passThroughData.hadSidechain = true;
        if (sidechain.hasAttribute('syncLevel')) currentState.sidechainSyncLevel = sidechain.getAttribute('syncLevel');
        if (sidechain.hasAttribute('syncType')) currentState.sidechainSyncType = sidechain.getAttribute('syncType');
        if (sidechain.hasAttribute('attack')) currentState.sidechainAttack = sidechain.getAttribute('attack');
        if (sidechain.hasAttribute('release')) currentState.sidechainRelease = sidechain.getAttribute('release');
        currentState.sidechainAttack = sidechainRawToIndex(currentState.sidechainAttack, SIDECHAIN_ATTACK_TABLE, 2);
        currentState.sidechainRelease = sidechainRawToIndex(currentState.sidechainRelease, SIDECHAIN_RELEASE_TABLE, 3);
    }

    // Parse the audio compressor - a separate effect from the sidechain above
    const audioCompressor = sound.querySelector('audioCompressor');
    if (audioCompressor) {
        const compAttr = (name, key) => {
            if (audioCompressor.hasAttribute(name)) currentState[key] = audioCompressor.getAttribute(name);
        };
        compAttr('attack', 'compAttack');
        compAttr('release', 'compRelease');
        compAttr('thresh', 'compThresh');
        compAttr('ratio', 'compRatio');
        compAttr('compHPF', 'compHPF');
        compAttr('compBlend', 'compBlend');
    }

    // Parse stutter config
    const stutter = sound.querySelector('stutter');
    if (stutter) {
        if (stutter.hasAttribute('quantized')) currentState.stutterQuantized = stutter.getAttribute('quantized');
        if (stutter.hasAttribute('reverse')) currentState.stutterReverse = stutter.getAttribute('reverse');
        if (stutter.hasAttribute('pingPong')) currentState.stutterPingPong = stutter.getAttribute('pingPong');
    }

    // Parse default params
    const defaultParams = sound.querySelector('defaultParams');
    if (defaultParams) {
        // Parse all hex parameters
        DEFAULT_PARAM_ATTRIBUTES.forEach(param => {
            if (defaultParams.hasAttribute(param)) {
                currentState[param] = defaultParams.getAttribute(param);
            }
        });

        // Keep the rest - compressorThreshold and the arpeggiator
        // probability/spread set have no UI and were being dropped
        for (const attr of defaultParams.attributes) {
            if (!DEFAULT_PARAM_ATTRIBUTES.includes(attr.name)) {
                passThroughData.defaultParamsAttributes[attr.name] = attr.value;
            }
        }

        for (const child of defaultParams.children) {
            if (!DEFAULT_PARAM_TAGS.includes(child.tagName)) {
                passThroughData.defaultParamsTags += serializeElement(child, 2);
            }
        }

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
            // Old firmware (pre-3.x) wrote the fields as child elements
            // (<source>velocity</source>) instead of attributes.
            const cableField = (name) => {
                if (cable.hasAttribute(name)) return cable.getAttribute(name);
                const child = cable.querySelector(name);
                return child ? child.textContent.trim() : null;
            };
            const entry = {
                source: cableField('source'),
                destination: cableField('destination'),
                amount: cableField('amount'),
                extraAttributes: {},
                subTags: ''
            };

            if (cable.hasAttribute('polarity')) entry.polarity = cable.getAttribute('polarity');
            if (cable.hasAttribute('rangeAdjustable')) entry.rangeAdjustable = cable.getAttribute('rangeAdjustable');

            const knownCableAttrs = ['source', 'destination', 'amount', 'polarity', 'rangeAdjustable'];
            for (const attr of cable.attributes) {
                if (!knownCableAttrs.includes(attr.name)) {
                    entry.extraAttributes[attr.name] = attr.value;
                }
            }
            // Skip the fields read above so an old-format file's children
            // aren't also replayed as pass-through sub-tags (they'd be
            // written twice, once as attributes and once as elements).
            for (const child of cable.children) {
                if (!knownCableAttrs.includes(child.tagName)) {
                    entry.subTags += serializeElement(child, 4);
                }
            }

            patchCables.push(entry);
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

    // Arpeggiator
    const arpeggiator = sound.querySelector('arpeggiator');
    if (arpeggiator) {
        const arpAttr = (name, key) => {
            if (arpeggiator.hasAttribute(name)) currentState[key] = arpeggiator.getAttribute(name);
        };
        // Prefer arpMode, matching the firmware, but fall back to the old mode
        // attribute so a pre-c1.1.0 file still shows the right on/off state.
        arpAttr('mode', 'arpMode');
        arpAttr('arpMode', 'arpMode');
        arpAttr('noteMode', 'arpNoteMode');
        arpAttr('octaveMode', 'arpOctaveMode');
        arpAttr('numOctaves', 'arpNumOctaves');
        arpAttr('syncLevel', 'arpSyncLevel');
        arpAttr('syncType', 'arpSyncType');
        arpAttr('chordType', 'arpChordType');
        arpAttr('mpeVelocity', 'arpMpeVelocity');
        arpAttr('stepRepeat', 'arpStepRepeat');
        arpAttr('randomizerLock', 'arpRandomizerLock');
        arpAttr('kitArp', 'arpKitArp');

        // Everything else - the locked probability arrays and notePattern
        passThroughData.arpeggiatorAttributes = {};
        for (const attr of arpeggiator.attributes) {
            if (!ARP_ATTRIBUTES.includes(attr.name)) {
                passThroughData.arpeggiatorAttributes[attr.name] = attr.value;
            }
        }
    }

    // Gold knob assignments. Only accept a full-length list: a short or
    // malformed one would bind assignments to the wrong knobs, and the
    // firmware defaults are a better answer than a misaligned guess.
    const modKnobElements = sound.querySelectorAll('modKnobs > modKnob');
    modKnobs = DEFAULT_MOD_KNOBS.map(knob => ({ ...knob }));
    // Old firmware (pre-3.x) wrote the fields as child elements
    // (<controlsParam>pan</controlsParam>) instead of attributes.
    const knobField = (el, name) => {
        if (el.hasAttribute(name)) return el.getAttribute(name);
        const child = el.querySelector(name);
        return child ? child.textContent.trim() : null;
    };
    if (modKnobElements.length === DEFAULT_MOD_KNOBS.length) {
        modKnobElements.forEach((el, i) => {
            const knob = { controlsParam: knobField(el, 'controlsParam') || 'none' };
            const source = knobField(el, 'patchAmountFromSource');
            if (source) {
                knob.patchAmountFromSource = source;
            }
            const secondSource = knobField(el, 'patchAmountFromSecondSource');
            if (secondSource) {
                knob.patchAmountFromSecondSource = secondSource;
            }
            modKnobs[i] = knob;

            const extras = {};
            for (const attr of el.attributes) {
                if (!['controlsParam', 'patchAmountFromSource', 'patchAmountFromSecondSource'].includes(attr.name)) {
                    extras[attr.name] = attr.value;
                }
            }
            if (Object.keys(extras).length) passThroughData.modKnobExtras[i] = extras;
        });
    } else if (modKnobElements.length > 0) {
        console.warn(`modKnobs has ${modKnobElements.length} entries, expected ${DEFAULT_MOD_KNOBS.length} - using firmware defaults`);
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
    renderModKnobs();
    Object.keys(sliderReadouts).forEach(updateSliderReadout);

    if (typeof updateKnobRelevance === 'function') {
        updateKnobRelevance();
    }

    if (typeof updateModFXLabels === 'function') {
        updateModFXLabels();
    }

    if (typeof updateSyncTypeStates === 'function') {
        updateSyncTypeStates();
    }

    // Show/hide DX7 panels based on oscillator types (hide covers reset /
    // loading a non-DX7 preset while a DX7 panel is showing)
    for (const oscNum of [1, 2]) {
        const container = document.getElementById(`osc${oscNum}DX7Container`);
        if (container) {
            const isDX7 = currentState[`osc${oscNum}Type`] === 'dx7';
            container.style.display = isDX7 ? 'block' : 'none';
            if (isDX7 && typeof initializeDX7UI === 'function') {
                initializeDX7UI(oscNum);
            }
        }
    }
    
    // Show/hide file containers based on oscillator types
    const osc1FileContainer = document.getElementById('osc1FileContainer');
    if (osc1FileContainer) {
        const isSample1 = currentState.osc1Type === 'sample' || currentState.osc1Type === 'wavetable';
        osc1FileContainer.style.display = isSample1 ? 'block' : 'none';
    }
    
    const osc2FileContainer = document.getElementById('osc2FileContainer');
    if (osc2FileContainer) {
        const isSample2 = currentState.osc2Type === 'sample' || currentState.osc2Type === 'wavetable';
        osc2FileContainer.style.display = isSample2 ? 'block' : 'none';
    }
}

function resetToDefault() {
    if (confirm('Reset all parameters to default values?')) {
        currentState = { ...defaultParams };
        patchCables = DEFAULT_PATCH_CABLES.map(cable => ({ ...cable }));
        modKnobs = DEFAULT_MOD_KNOBS.map(knob => ({ ...knob }));
        originalLoadedFilepath = null; // Clear since we're starting fresh
        
        // Clear pass-through data
        passThroughData = emptyPassThroughData();


        updateUIFromState();
        
        // Send MIDI CC for all parameters (if MIDI CC is enabled)
        if (typeof sendAllMIDICCs === 'function') {
            sendAllMIDICCs();
        }
        
        updateSavePathIndicator();
        showNotification('✓ Reset to default values');
    }
}

