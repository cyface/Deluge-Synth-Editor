# Deluge Synth Editor

A web-based synth preset editor for the Synthstrom Deluge, featuring graphical controls and full parameter editing. Essentially just allows you to create, load, edit and export synth XML files with a simple web UI. 

## WARNING - not that this will break anything, but it has gone through very little testing. 

## Features

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

## Usage

### Getting Started

1. Open `deluge-synth-editor.html` in your web browser (any modern browser)
2. Edit parameters using the tabbed interface (or click "🎲 Randomize" for instant inspiration!)
3. Click "Download XML" to save your preset
4. Copy the XML file to your Deluge SD card (`SYNTHS/` folder)
5. Load it on your Deluge!

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
- **Envelopes**: ENV1-4 with **live animated visual displays**
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

### Saving Presets

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

## Browser Compatibility

### Full Features (with SYSEX):
- **Chrome/Edge 90+** ✅ (Recommended)
- **Opera 76+** ✅

### Basic Features (no SYSEX):
- **Firefox 88+** (Web MIDI requires enabling in about:config)
- **Safari 14+** (Web MIDI experimental)

**Note:** There is some code I used for testing to allow SYSEX but this doesn't seem to work yet, despite being able to connect to Deluge. Commented out for now.

## License

This editor is provided as-is for use with the Synthstrom Deluge synthesizer.

## Credits

Created for the Deluge community as a complement to the Community Firmware project.

