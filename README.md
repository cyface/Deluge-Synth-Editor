# Deluge Synth Editor

A comprehensive web-based synth preset editor for the Synthstrom Deluge, featuring graphical controls and full parameter editing.

## Features

- **🔌 Direct Deluge Connection via SYSEX** (EXPERIMENTAL):
  - Hidden by default - enable via "Show Experimental Features" checkbox
  - **May not work yet** - JSON SYSEX file API appears incomplete in firmware
  - If working: Send presets directly to Deluge SD card via USB Port 3
  - If working: Browse and load presets from your Deluge's SD card
  - **Recommended**: Use standard download/copy workflow instead

- **Complete Parameter Coverage**: Edit all Deluge synth parameters including:
  - Oscillators (with sample/wavetable file support)
  - Envelopes (4 envelopes with live animated visual display)
  - Filters (LPF/HPF with morphing)
  - LFOs (4 total - 2 global, 2 local)
  - Effects (Modulation FX, Delay, Reverb, EQ, Distortion)
  - Modulation Matrix (Patch Cables)
  - Master settings, Unison, Sidechain

- **Graphical Interface**:
  - Interactive knobs with mouse/touch control
  - Sliders for precise parameter adjustment
  - **Live animated envelope displays** - watch envelopes update in real-time as you adjust ADSR values
  - Tabbed interface for organized editing

- **XML Import/Export**:
  - Load existing Deluge synth presets from files
  - Generate compatible XML files
  - Download presets to your computer
  - **OR send directly to Deluge via SYSEX!**

## Usage

### Getting Started

1. Open `deluge-synth-editor.html` in your web browser (any modern browser)
2. Edit parameters using the tabbed interface (or click "🎲 Randomize" for instant inspiration!)
3. Click "Download XML" to save your preset
4. Copy the XML file to your Deluge SD card (`SYNTHS/` folder)
5. Load it on your Deluge!

**Note:** SYSEX features (direct connection) are experimental and hidden by default. Enable the checkbox if you want to try them.

### Loading Presets

1. Click "Load XML" button
2. Select a Deluge synth preset file (.XML)
3. All parameters will be loaded into the editor

### Editing Parameters

- **Knobs**: Click and drag up/down to adjust values
- **Sliders**: Drag or click to set values
- **Dropdowns**: Select from available options
- **Text Fields**: Enter values directly

### Tabs

- **General**: Polyphonic mode, voice priority, synth mode, unison
- **Oscillators**: OSC1, OSC2, noise generator, sample/wavetable files, FM synthesis parameters (modulators & carriers)
- **Envelopes**: ENV1-4 with **live animated visual displays** - adjust knobs and watch the envelope shape update in real-time
  - ENV1: Amplitude envelope (unipolar sustain 0-50)
  - ENV2-4: Modulation envelopes (bipolar sustain -25 to +25)
- **Filters**: LPF/HPF with frequency, resonance, morphing, and routing
- **LFOs**: LFO1 (global) and LFO2 (local) with sync options
- **Effects**: Master volume/pan, ModFX, delay, reverb, EQ, distortion, sidechain
- **Modulation**: Patch cable matrix for modulation routing (supports all 4 envelopes as sources)

### Modulation Matrix

1. Click "+ Add Patch Cable" to create a new modulation
2. Select Source (e.g., LFO1, Envelope1, Velocity)
3. Select Destination (e.g., Filter Frequency, Volume, Pitch)
4. Adjust Amount slider (-50 to +50)
5. Click "✕" to remove a patch cable

### Sample/Wavetable Files

- In the Oscillators tab, use the file path fields to specify samples
- Example: `SAMPLES/my-sample.wav`
- Path is relative to the Deluge SD card root

### Experimental: Direct SYSEX Connection (Advanced Users Only)

**⚠️ Warning:** The JSON SYSEX file API appears to be incomplete in current firmware. Use at your own risk!

**To Enable:**
1. Check the "Show Experimental Features" checkbox at the top
2. SYSEX buttons will appear

**If you want to try it:**
1. Flash firmware with `ENABLE_SYSEX_LOAD=ON` (build provided: `deluge-sysex-enabled.bin`)
2. Enable "Dev Sysex" in Deluge: Settings → Community Features → Dev Sysex → ON
3. Connect via USB Port 3
4. Try the connection buttons (may timeout - feature may not be fully implemented)

**Recommended:** Just use the standard download/copy workflow - it's fast and reliable!

### Saving Presets (Recommended Method)

1. Enter a preset name
2. Click "Download XML"
3. Copy the file to your Deluge SD card in the `SYNTHS/` folder
4. Eject SD card and insert into Deluge
5. Load preset on Deluge!

## Technical Notes

### Parameter Format

- Parameters are stored as 32-bit signed integers in hexadecimal (e.g., `0x7FFFFFFF`)
- The UI converts these to user-friendly values (dB, Hz, ms, etc.)
- Range: `0x80000000` (-2147483648) to `0x7FFFFFFF` (2147483647)

### Compatibility

- Supports Deluge Community Firmware c1.0+ format
- Compatible with official firmware 4.0+
- Both old format (nested tags) and new format (attributes) are supported

### Skipped Features

- **DX7 Editing**: Due to complexity, DX7 patch editing is not included
- **Kit Presets**: This editor is for synth presets only, not kits
- **MIDI Configuration**: MIDI setup is not included
- **Arpeggiator**: Basic arpeggiator settings only

## Browser Compatibility

### Full Features (with SYSEX):
- **Chrome/Edge 90+** ✅ (Recommended)
- **Opera 76+** ✅

### Basic Features (no SYSEX):
- **Firefox 88+** (Web MIDI requires enabling in about:config)
- **Safari 14+** (Web MIDI experimental)

**Note:** SYSEX features (direct Deluge connection) require Web MIDI API support. All browsers support basic XML import/export.

No internet connection required - runs entirely in your browser!

## File Structure

```
synth-editor/
├── deluge-synth-editor.html    # Main HTML file
├── deluge-synth-editor.js      # JavaScript logic
├── logo-deluge@2x.png         # Deluge logo
└── README.md                   # This file
```

## Tips

- **Default Workflow**: Download XML → Copy to SD card → Load on Deluge (simple and reliable!)
- Use the **"🎲 Randomize"** button to instantly create random presets - great for happy accidents and inspiration!
  - Note: General tab (poly mode, synth mode, unison) is NOT randomized - set these first, then randomize the rest
  - Oscillator types are limited to basic waveforms (no wavetable/sample types that require file paths)
- Use the "Reset to Default" button to start with a clean slate
- Hover over knobs to see their current values
- **Envelope Animation**: Drag any envelope knob (Attack, Decay, Sustain, Release) and watch the envelope curve animate in real-time!
- All 4 envelopes support different sustain ranges:
  - ENV1 (amplitude): 0 to 50 (unipolar)
  - ENV2-4 (modulation): -25 to +25 (bipolar)
- Use Envelope 3 and 4 as modulation sources in the Modulation tab
- **FM Synthesis**: Set synth mode to "FM" in the General tab, then use the FM parameters in the Oscillators tab:
  - Modulator 1 & 2: Amount and Feedback
  - Carrier 1 & 2: Feedback controls
- **Workflow**: Create/edit preset → Send to Deluge → Load on Deluge → Tweak → Send back!
- Test presets on your Deluge to hear the results!

## License

This editor is provided as-is for use with the Synthstrom Deluge synthesizer.

## Credits

Created for the Deluge community as a complement to the Community Firmware project.

