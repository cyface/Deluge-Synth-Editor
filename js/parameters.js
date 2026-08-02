// Deluge Synth Editor - Parameter Definitions & Conversions
// This file contains all parameter defaults, state management, and value conversion functions

// ============================================================================
// PARAMETER DEFINITIONS
// ============================================================================

// Default parameter values (as hex strings used in Deluge XML)
const defaultParams = {
    // General
    polyphonic: 'poly',
    voicePriority: '1',
    mode: 'subtractive',
    transpose: '0',
    maxVoices: '8',

    // Unison
    unisonNum: '1',
    unisonDetune: '8',
    unisonSpread: '0',

    // Oscillators
    osc1Type: 'square',
    osc1Transpose: '0',
    osc1Cents: '0',
    osc1RetrigPhase: '-1',
    osc1IsTracking: '1',  // Tracks keyboard pitch (1=yes, 0=no)
    osc1File: '',
    osc1DX7Patch: '',           // 156-byte DX7 voice data (hex string)
    osc1DX7EngineMode: '0',     // DX7 engine implementation (0=default, 1=NEON, 2=alt)
    osc1DX7RandomDetune: '0',   // Analog-style detuning per voice (0-100)
    osc1DX7SourceFile: '',      // Source .syx filepath for display
    osc1DX7PatchIndex: '',      // Patch index if from cartridge (1-32)

    osc2Type: 'square',
    osc2Transpose: '-12',
    osc2Cents: '0',
    osc2RetrigPhase: '-1',
    osc2IsTracking: '1',
    osc2Sync: '0',
    osc2File: '',
    osc2DX7Patch: '',           // 156-byte DX7 voice data (hex string)
    osc2DX7EngineMode: '0',     // DX7 engine implementation (0=default, 1=NEON, 2=alt)
    osc2DX7RandomDetune: '0',   // Analog-style detuning per voice (0-100)
    osc2DX7SourceFile: '',      // Source .syx filepath for display
    osc2DX7PatchIndex: '',      // Patch index if from cartridge (1-32)

    // Oscillator levels (hex values)
    oscAVolume: '0x7FFFFFFF',
    oscAPulseWidth: '0x00000000',
    oscAWavetablePosition: '0x00000000',
    oscBVolume: '0x80000000',
    oscBPulseWidth: '0x00000000',
    oscBWavetablePosition: '0x00000000',
    noiseVolume: '0x80000000',

    // Master
    volume: '0x4CCCCCA8',
    pan: '0x00000000',
    portamento: '0x80000000',

    // Envelopes (hex values)
    env1Attack: '0x80000000',
    env1Decay: '0xE6666654',
    env1Sustain: '0x7FFFFFFF',
    env1Release: '0x851EB851',

    env2Attack: '0xE6666654',
    env2Decay: '0xE6666654',
    env2Sustain: '0xFFFFFFE9',
    env2Release: '0xE6666654',

    env3Attack: '0xE6666654',
    env3Decay: '0xE6666654',
    env3Sustain: '0xFFFFFFE9',
    env3Release: '0xE6666654',

    env4Attack: '0xE6666654',
    env4Decay: '0xE6666654',
    env4Sustain: '0xFFFFFFE9',
    env4Release: '0xE6666654',

    // Filters
    lpfMode: '24dB',
    lpfFrequency: '0x00000000',  // UI 25 (middle position, audible filtering)
    lpfResonance: '0xB3333333',  // UI 10 (some resonance so filter is audible)
    lpfMorph: '0x80000000',

    hpfMode: 'HPLadder',
    hpfFrequency: '0x80000000',  // UI 0 (closed, no HPF effect by default)
    hpfResonance: '0xB3333333',  // UI 10 (some resonance for audible filtering)
    hpfMorph: '0x80000000',

    filterRoute: 'H2L',  // HPF to LPF routing
    waveFold: '0x80000000',

    // LFOs (Community Firmware supports 4 LFOs total)
    lfo1Type: 'triangle',
    lfo1SyncLevel: '0',
    lfo1SyncType: '0',
    lfo1Rate: '0x1999997E',

    lfo2Type: 'triangle',
    lfo2SyncLevel: '0',
    lfo2SyncType: '0',
    lfo2Rate: '0x00000000',
    
    lfo3Type: 'triangle',
    lfo3SyncLevel: '0',
    lfo3SyncType: '0',
    lfo3Rate: '0x00000000',
    
    lfo4Type: 'triangle',
    lfo4SyncLevel: '0',
    lfo4SyncType: '0',
    lfo4Rate: '0x00000000',

    // Effects
    modFXType: 'none',
    modFXRate: '0x00000000',
    modFXDepth: '0x00000000',
    modFXOffset: '0x00000000',
    modFXFeedback: '0x00000000',

    delayPingPong: '1',
    delayAnalog: '1',
    delaySyncLevel: '7',
    delaySyncType: '0',
    delayRate: '0x00000000',
    delayFeedback: '0x80000000',

    reverbAmount: '0x80000000',

    bass: '0x00000000',
    treble: '0x00000000',
    bassFrequency: '0x00000000',
    trebleFrequency: '0x00000000',

    sampleRateReduction: '0x80000000',
    bitCrush: '0x80000000',
    stutterRate: '0x00000000',

    // Sidechain (the ducking envelope follower, <sidechain>)
    sidechainSend: '0',        // Sidechain send level (sound attribute)
    sidechainSyncLevel: '6',
    sidechainSyncType: '0',
    sidechainAttack: '327244',
    sidechainRelease: '936',

    // Audio compressor (<audioCompressor>) - a separate effect from the
    // sidechain above. Every value is a knob position in 0 .. 2147483647
    // (unsigned), NOT the signed hex scale <defaultParams> uses. Defaults match
    // RMSFeedbackCompressor's constructor (dsp/compressor/rms_feedback.cpp:22),
    // which is inert: thresh=0 means a threshold of 1.0, so nothing compresses.
    compAttack: '83886080',
    compRelease: '83886080',
    compThresh: '0',
    compRatio: '1073741824',
    compHPF: '0',
    compBlend: '2147483647',

    // Stutter config (<stutter>) - 0/1 flags
    stutterQuantized: '1',
    stutterReverse: '0',
    stutterPingPong: '0',


    // Clipping
    clippingAmount: '0',
    compressorShape: '0xDC28F5B2',

    // Arpeggiator (<arpeggiator>). arpMode is what current firmware reads;
    // the older "mode" attribute is written alongside it from the same value
    // (see generateXML) because the Deluge does, but it is only honoured on
    // files declaring a firmware below c1.1.0 (arpeggiator.cpp:1747-1759).
    arpMode: 'off',
    arpNoteMode: 'up',
    arpOctaveMode: 'up',
    arpNumOctaves: '2',
    arpSyncLevel: '7',
    arpSyncType: '0',
    arpChordType: '0',
    arpMpeVelocity: 'off',
    arpStepRepeat: '1',
    arpRandomizerLock: '0',
    arpKitArp: '0',
    arpeggiatorGate: '0x00000000',
    arpeggiatorRate: '0x00000000',

    // FM parameters (for FM mode)
    modulator1Amount: '0x80000000',
    modulator1Feedback: '0x80000000',
    modulator2Amount: '0x80000000',
    modulator2Feedback: '0x80000000',
    carrier1Feedback: '0x80000000',
    carrier2Feedback: '0x80000000'
};

// Current state
let currentState = { ...defaultParams };
let patchCables = [];

// Gold-knob assignments (<modKnobs>). 8 mod-button pages x 2 physical knobs,
// written as a flat ordered list - position in the list is the only thing that
// says which knob an entry belongs to, so the array is always exactly 16 long.
let modKnobs = [];

// Pass-through storage for parameters we don't have UI for.
// This preserves data when loading and re-saving files - a Deluge-authored
// preset carries a lot the editor has no controls for (MIDI output config,
// arpeggiator probability params), and dropping any of it on save would
// quietly damage the user's patch.
function emptyPassThroughData() {
    return {
        soundAttributes: {},        // Attributes on <sound> we don't edit
        osc1Attributes: {},         // Attributes on <osc1> we don't edit
        osc2Attributes: {},         // Attributes on <osc2> we don't edit
        osc1SubTags: '',            // Sub-tags inside <osc1> (like <zone>, <sampleRanges>)
        osc2SubTags: '',            // Sub-tags inside <osc2>
        defaultParamsAttributes: {},// Attributes on <defaultParams> we don't edit
        defaultParamsTags: '',      // Sub-tags inside <defaultParams> we don't edit
        arpeggiatorAttributes: null,// <arpeggiator> attributes, replayed verbatim
        hadSidechain: false,        // Source had a <sidechain>, so always write one back
        modKnobExtras: {},          // Attributes on <modKnob> we don't edit, by index
        unknownTags: ''             // Whole <sound> child elements we don't recognize
    };
}

let passThroughData = emptyPassThroughData();

// Attributes on <defaultParams> that generateXML() writes itself. Anything else
// found there is preserved via passThroughData.defaultParamsAttributes.
const DEFAULT_PARAM_ATTRIBUTES = [
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

// Attributes on <sound> that generateXML() writes itself.
const SOUND_ATTRIBUTES = [
    'firmwareVersion', 'earliestCompatibleFirmware', 'polyphonic', 'voicePriority',
    'sideChainSend', 'mode', 'transpose', 'modFXType', 'lpfMode', 'hpfMode',
    'filterRoute', 'clippingAmount', 'maxVoices'
];

// Child elements of <sound> that generateXML() writes itself.
const SOUND_TAGS = [
    'osc1', 'osc2', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'unison', 'delay',
    'sidechain', 'compressor', 'defaultParams', 'arpeggiator',
    'audioCompressor', 'stutter', 'modKnobs'
];

// Child elements of <defaultParams> that generateXML() writes itself.
const DEFAULT_PARAM_TAGS = [
    'envelope1', 'envelope2', 'envelope3', 'envelope4', 'patchCables', 'equalizer'
];

// Child elements of <osc1>/<osc2> that old-format files use to hold values the
// parser reads directly. Excluded from sub-tag pass-through to avoid writing
// them twice.
const OSC_VALUE_TAGS = ['type', 'transpose', 'cents', 'retrigPhase', 'oscillatorSync'];

// Modulation sources and destinations
const modSources = [
    'none', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 
    'envelope1', 'envelope2', 'envelope3', 'envelope4',
    'velocity', 'note', 'aftertouch', 'x', 'y',
    'compressor', 'random'
];

// <arpeggiator> attributes generateXML() writes itself. Everything else there -
// the locked probability arrays, notePattern, and the lastLocked* values - is
// preserved through passThroughData.arpeggiatorAttributes.
const ARP_ATTRIBUTES = [
    'mode', 'arpMode', 'noteMode', 'octaveMode', 'numOctaves',
    'syncLevel', 'syncType', 'chordType', 'mpeVelocity',
    'stepRepeat', 'randomizerLock', 'kitArp'
];

// Chord shapes the arpeggiator can play, indexed by chordType
// (util/lookuptables/lookuptables.cpp:518).
const ARP_CHORD_TYPES = [
    'None', 'Fifth', 'Sus2', 'Minor', 'Major', 'Sus4', 'Minor 7',
    'Dominant 7', 'Major 7'
];

// Parameters a gold knob can be assigned to, in <modKnob controlsParam="...">.
//
// This is a different namespace from modDestinations above. The firmware
// resolves the string with fileStringToParam(Kind::UNPATCHED_SOUND, name,
// allowPatched=true), which reaches patched local params, patched global params
// and the shared unpatched set - so names like "volumePostFX", "bitcrushAmount"
// and "portamento" are valid here but are not patch-cable destinations, while
// "volume" means a different param in each list. Names below are taken verbatim
// from paramNameForFileConst() in modulation/params/param.cpp; anything not in
// this list reads back as GLOBAL_NONE and the assignment is silently discarded.
const modKnobParams = [
    'none',
    // Patched local
    'volume', 'pan', 'pitch',
    'oscAVolume', 'oscAPitch', 'oscAPhaseWidth', 'oscAWavetablePosition',
    'oscBVolume', 'oscBPitch', 'oscBPhaseWidth', 'oscBWavetablePosition',
    'noiseVolume',
    'lpfFrequency', 'lpfResonance', 'lpfMorph',
    'hpfFrequency', 'hpfResonance', 'hpfMorph',
    'lfo2Rate', 'lfo4Rate',
    'env1Attack', 'env1Decay', 'env1Sustain', 'env1Release',
    'env2Attack', 'env2Decay', 'env2Sustain', 'env2Release',
    'env3Attack', 'env3Decay', 'env3Sustain', 'env3Release',
    'env4Attack', 'env4Decay', 'env4Sustain', 'env4Release',
    'modulator1Volume', 'modulator1Pitch', 'modulator1Feedback',
    'modulator2Volume', 'modulator2Pitch', 'modulator2Feedback',
    'carrier1Feedback', 'carrier2Feedback', 'waveFold',
    // Patched global
    'volumePostFX', 'volumePostReverbSend',
    'lfo1Rate', 'lfo3Rate',
    'modFXRate', 'modFXDepth',
    'delayRate', 'delayFeedback', 'reverbAmount', 'arpRate',
    // Unpatched, shared between sounds and the song
    'portamento', 'stutterRate', 'sampleRateReduction', 'bitcrushAmount',
    'modFXOffset', 'modFXFeedback',
    'bass', 'treble', 'bassFreq', 'trebleFreq',
    'compressorShape', 'compressorThreshold',
    'arpGate', 'noteProbability', 'bassProbability', 'swapProbability',
    'glideProbability', 'reverseProbability', 'chordPolyphony',
    'chordProbability', 'ratchetProbability', 'ratchetAmount',
    'sequenceLength', 'rhythm', 'spreadGate', 'spreadOctave', 'spreadVelocity'
];

// The eight mod-button pages, in the order <modKnobs> serializes them.
const MOD_KNOB_PAGES = [
    'Master (Volume/Pan)', 'Filters (LPF)', 'Envelope 1', 'Delay',
    'Reverb / Sidechain', 'LFO / Pitch', 'Stutter / Portamento', 'Distortion'
];

// What the Deluge assigns when it builds a Sound from scratch
// (processing/sound/sound.cpp:97-122). Index = page * 2 + knob, knob 0 is the
// bottom knob and 1 is the top one - the same order the file uses.
const DEFAULT_MOD_KNOBS = [
    { controlsParam: 'pan' },
    { controlsParam: 'volumePostFX' },
    { controlsParam: 'lpfResonance' },
    { controlsParam: 'lpfFrequency' },
    { controlsParam: 'env1Release' },
    { controlsParam: 'env1Attack' },
    { controlsParam: 'delayFeedback' },
    { controlsParam: 'delayRate' },
    { controlsParam: 'reverbAmount' },
    { controlsParam: 'volumePostReverbSend', patchAmountFromSource: 'compressor' },
    { controlsParam: 'pitch', patchAmountFromSource: 'lfo1' },
    { controlsParam: 'lfo1Rate' },
    { controlsParam: 'portamento' },
    { controlsParam: 'stutterRate' },
    { controlsParam: 'bitcrushAmount' },
    { controlsParam: 'sampleRateReduction' }
];

const modDestinations = [
    'volume', 'pan', 'pitch',
    'oscAVolume', 'oscAPitch', 'oscAPhaseWidth', 'oscAWavetablePosition',
    'oscBVolume', 'oscBPitch', 'oscBPhaseWidth', 'oscBWavetablePosition',
    'noiseVolume',
    'lpfFrequency', 'lpfResonance',
    'hpfFrequency', 'hpfResonance',
    'lfo1Rate', 'lfo2Rate', 'lfo3Rate', 'lfo4Rate',
    'modFXRate', 'modFXDepth',
    'delayRate', 'delayFeedback',
    'reverbAmount',
    'env1Attack', 'env1Decay', 'env1Sustain', 'env1Release',
    'env2Attack', 'env2Decay', 'env2Sustain', 'env2Release',
    'env3Attack', 'env3Decay', 'env3Sustain', 'env3Release',
    'env4Attack', 'env4Decay', 'env4Sustain', 'env4Release',
    'carrier1Feedback', 'carrier2Feedback',
    'modulator1Amount', 'modulator1Feedback',
    'modulator2Amount', 'modulator2Feedback'
];

// ============================================================================
// VALUE CONVERSION FUNCTIONS
// ============================================================================

// Read an input's value, held to the min/max it declares.
//
// The browser only enforces min/max on the spinner arrows and on form
// submission. Nothing here submits a form, so a typed-in out-of-range value
// stays in .value and lands in the preset unchanged. That is how a
// <unison num="0" /> gets written past min="1" - the Deluge loads the file
// happily and then renders no unison voices at all, so the preset is silent.
function readInputValue(input) {
    if (input.type !== 'number' || input.value === '') {
        return input.value;
    }

    const value = parseFloat(input.value);
    if (Number.isNaN(value)) {
        return input.value;
    }

    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    let clamped = value;
    if (!Number.isNaN(min) && clamped < min) clamped = min;
    if (!Number.isNaN(max) && clamped > max) clamped = max;

    // Reflect the correction back so the UI can't disagree with what we save.
    if (clamped !== value) {
        input.value = clamped;
    }
    return String(clamped);
}

// Full-scale knob position for the params that slide rather than turn. Unlike
// <defaultParams>, these run 0 .. ONE_Q31 rather than spanning the signed range,
// so the hex conversions above do not apply to them.
const SLIDER_KNOB_MAX = 2147483647;

// Human-readable versions of those knob positions, using the firmware's own
// mappings so the numbers match what the Deluge displays
// (dsp/compressor/rms_feedback.h, the set* functions).
const sliderReadouts = {
    // attackMS = 0.5 + (exp(2x) - 1) * 10
    compAttack: pos => (0.5 + (Math.exp(2 * pos / SLIDER_KNOB_MAX) - 1) * 10).toFixed(1) + ' ms',
    // releaseMS = 50 + (exp(2x) - 1) * 50
    compRelease: pos => (50 + (Math.exp(2 * pos / SLIDER_KNOB_MAX) - 1) * 50).toFixed(0) + ' ms',
    // threshold = 1 - 0.8x, so a higher knob position compresses sooner
    compThresh: pos => (100 * pos / SLIDER_KNOB_MAX).toFixed(0) + '%',
    // ratio = 1 / (1 - (0.5 + x/2)), i.e. 2:1 at zero rising steeply near full
    compRatio: pos => {
        const fraction = 0.5 + (pos / SLIDER_KNOB_MAX) / 2;
        const ratio = 1 / (1 - fraction);
        return (ratio >= 100 ? '∞' : ratio.toFixed(1)) + ':1';
    },
    // fc_hz = (exp(1.5x) - 1) * 30
    compHPF: pos => ((Math.exp(1.5 * pos / SLIDER_KNOB_MAX) - 1) * 30).toFixed(0) + ' Hz',
    compBlend: pos => (100 * pos / SLIDER_KNOB_MAX).toFixed(0) + '% wet',
    // The Deluge shows this on its own 0-50 menu scale (gui/menu_item/sidechain/send.h:33)
    sidechainSend: pos => pos === 0 ? 'Off' : (50 * pos / SLIDER_KNOB_MAX).toFixed(0) + ' / 50'
};

// Convert UI value (-50 to 50) to Deluge hex format (signed 32-bit)
function uiToHex(value, min = -50, max = 50) {
    // Normalize to 0-1 range
    const normalized = (value - min) / (max - min);

    // Convert to signed 32-bit integer range
    // 0x80000000 (-2147483648) to 0x7FFFFFFF (2147483647)
    const deluge_min = -2147483648;
    const deluge_max = 2147483647;
    const delugeValue = Math.round(deluge_min + (normalized * (deluge_max - deluge_min)));

    // Convert to unsigned for hex representation
    const unsigned = delugeValue >>> 0;
    return '0x' + unsigned.toString(16).toUpperCase().padStart(8, '0');
}

// Convert Deluge hex to UI value
function hexToUI(hexStr, min = -50, max = 50) {
    if (!hexStr || hexStr === '') return 0;

    // Parse hex value
    const unsigned = parseInt(hexStr, 16);
    // Convert to signed
    const signed = unsigned > 0x7FFFFFFF ? unsigned - 0x100000000 : unsigned;

    // Normalize from Deluge range to 0-1
    const deluge_min = -2147483648;
    const deluge_max = 2147483647;
    const normalized = (signed - deluge_min) / (deluge_max - deluge_min);

    // Scale to UI range
    return min + (normalized * (max - min));
}

// Format display values
function formatDisplayValue(paramName, uiValue) {
    const absValue = Math.abs(uiValue);

    // Volume parameters
    if (paramName.includes('Volume') || paramName === 'volume') {
        if (uiValue <= -49) return '-∞ dB';
        return uiValue.toFixed(1) + ' dB';
    }

    // Pan
    if (paramName === 'pan') {
        if (Math.abs(uiValue) < 1) return 'Center';
        return uiValue > 0 ? 'R' + uiValue.toFixed(0) : 'L' + Math.abs(uiValue).toFixed(0);
    }

    // Filter frequency (approximate)
    if (paramName.includes('Frequency') && (paramName.includes('lpf') || paramName.includes('hpf'))) {
        const freq = 20 * Math.pow(1000, uiValue / 50);
        if (freq < 1000) return freq.toFixed(0) + ' Hz';
        return (freq / 1000).toFixed(1) + ' kHz';
    }

    // LFO Rate (approximate Hz)
    if (paramName.includes('Rate') && paramName.includes('lfo')) {
        const hz = 0.01 + (uiValue / 50) * 50;
        return hz.toFixed(2) + ' Hz';
    }

    // Envelope times (rough approximation in ms)
    if (paramName.includes('Attack') || paramName.includes('Decay') || paramName.includes('Release')) {
        const ms = Math.pow(10, uiValue / 16.67) * 0.5;
        if (ms < 10) return ms.toFixed(1) + ' ms';
        if (ms < 1000) return ms.toFixed(0) + ' ms';
        return (ms / 1000).toFixed(2) + ' s';
    }

    // Generic percentage
    return uiValue.toFixed(0);
}

