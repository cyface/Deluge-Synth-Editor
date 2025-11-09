# Deluge Browser-based Synth Editor

A web-based synth preset editor for the Synthstrom Deluge, featuring graphical controls, full parameter editing, and optional direct SYSEX file transfer.

**Works with ANY Deluge firmware** for offline XML editing. Direct USB transfer requires **Community Firmware 1.3+** or **Official Firmware 4.0+**.

⚠️ **A SOFTWARE** - Not fully tested so use at your own risk. Always backup your presets! 

## Features

### ✨ **Parameter Coverage**
Edit all essential Deluge synth parameters:
- **Oscillators**: Type, pitch, FM synthesis, sample/wavetable files, **DX7 patches**
- **Envelopes**: 4 envelopes with live animated visual displays
- **Filters**: LPF/HPF with frequency, resonance, morphing, routing
- **LFOs**: LFO1-4 with sync options (Community Firmware)
- **Effects**: ModFX, Delay, Reverb, EQ, Distortion
- **Modulation Matrix**: Complete patch cable system
- **Master**: Volume, pan, portamento, unison, sidechain

### 🎨 **Graphical Interface**
- Interactive knobs with mouse/touch control
- Sliders for precise parameter adjustment
- **Live animated envelope displays** - watch ADSR in real-time
- Tabbed interface for organized editing
- Real-time save path indicator

### 📁 **Two Workflows**

**1. Offline XML Workflow** (Works with ANY firmware)
- Load/save XML files from your computer
- Edit parameters graphically
- Download XML and copy to SD card
- Compatible with all Deluge firmware versions

**2. Direct SYSEX Transfer** (Requires Community FW 1.3+ or Official FW 4.0+)
- Connect Deluge via USB (no SD card removal!)
- Browse and load presets directly from Deluge
- Send edited presets back instantly
- Browse and select sample files from `/SAMPLES/`
- **Load DX7 patches from Deluge** (browse .syx files, select from cartridges)
- Preserves directory structure
- Overwrite protection with confirmation dialogs

### 🎹 **DX7 FM Synthesis Support**
- Load Yamaha DX7 patches (.syx files) directly from Deluge SD card via SYSEX
- Cartridge support - browse and select individual patches from 32-voice cartridge banks
- Complete 156-byte voice data embedded in XML for round-trip editing
- Deluge-specific parameters: Engine mode (Auto/Modern/Mark I) and analog-style random detune (0-100)
- Patches editable on Deluge hardware or in Dexed external editor, with full operator/envelope control preserved

## Quick Start

### Option 1: Offline Workflow (ANY Firmware)

Works with **any Deluge firmware version** - no USB connection needed!

1. Open `index.html` in any modern web browser
2. **Edit parameters:**
   - Use tabs to navigate (General, Oscillators, Envelopes, etc.)
   - Turn knobs by clicking and dragging
   - Adjust sliders for precise control
   - Watch envelope animations update in real-time
3. Click **"Download XML"**
4. Copy the `.XML` file to your Deluge SD card (`SYNTHS/` folder)
5. Load the preset on your Deluge!

### Option 2: Live SYSEX Workflow (Community FW 1.3+ / Official FW 4.0+)

Direct USB transfer - no SD card removal needed!

**Requirements:**
- ✅ Deluge with **Community Firmware 1.3+** OR **Official Firmware 4.0+**
- ✅ **Chrome** or **Edge** browser (Firefox/Safari have limited Web MIDI support)
- ✅ USB cable connected to **Port 3** (rightmost USB port on Deluge)

**Steps:**
1. Open `index.html` in Chrome or Edge
2. Connect Deluge via USB Port 3
3. Click **"🔌 Connect to Deluge"**
   - Grant MIDI permissions when prompted
   - Wait for "✅ Connected" message
4. Click **"📥 Load from Deluge"** to browse your presets
   - Navigate folders (automatically locked to `/SYNTHS/`)
   - Click any `.XML` file to load it
   - Use 📁 buttons next to OSC sample inputs to browse `/SAMPLES/`
5. **Edit parameters** as desired
6. Click **"📤 Send to Deluge"**
   - Saves to original folder (or root if renamed)
   - Asks for confirmation if file exists
   - Shows "HELLO SYSEX" popup on Deluge display
7. **On Deluge:** `SHIFT + LOAD` → Navigate to preset → `SELECT` to reload and hear changes

💡 **Tip:** The save path indicator shows exactly where your file will be saved!

See [SYSEX_SETUP.md](SYSEX_SETUP.md) for detailed SYSEX troubleshooting.

## Editor Tabs

- **General**: Polyphonic mode, voice priority, synth mode, unison, max voices
- **Oscillators**: OSC1/OSC2 type, pitch, FM synthesis, sample/wavetable file browser
- **Envelopes**: ENV1-4 with **live animated ADSR displays**
- **Filters**: LPF/HPF with frequency, resonance, morphing, routing
- **LFOs**: LFO1-2 with type, rate, and sync options
- **Effects**: Master volume/pan, ModFX, delay, reverb, EQ, distortion, sidechain
- **Modulation**: Patch cable matrix - route any source to any destination

## Supported Parameters

### ✅ **Fully Supported (Editable UI)**
- Oscillator types: Square, Saw, Triangle, Sine, Analog models, Sample, Wavetable, DX7
- Oscillator pitch: Transpose (-48 to +48 semitones), cents, retrigger phase
- Sample/Wavetable file paths with browse button (SYSEX mode)
- FM synthesis: Modulator 1 & 2, Carrier 1 & 2 feedback
- All 4 envelopes (attack, decay, sustain, release)
- Filter modes, frequency, resonance, morphing (LPF and HPF)
- Filter routing: HPF→LPF, LPF→HPF, parallel
- LFO 1-2: Type, rate, sync level, sync type
- Unison: Voice count (1-8), detune, stereo spread
- All effects: ModFX (all types), delay, reverb, EQ, distortion
- Modulation matrix: Complete patch cable system with all sources/destinations
- Master: Volume, pan, portamento
- Sidechain/Compressor: Sync, attack, release

### ✅ **Supported (Read/Write, No UI)**
Preserved when loading and saving files:
- LFO 3 & 4 (Community Firmware) - written to XML, preserved on load
- isTracking attribute (oscillators)
- Sample-specific: Loop mode, reversed, time stretch, interpolation, sample zones
- DX7 patches (156-byte hex data)
- Multi-sampling and multi-wavetable ranges
- MIDI knobs and Mod knobs
- Clipping amount
- Sidechain send level

### ❌ **Not Supported**
- **Kit Presets** - This editor is for synth presets only
- **DX7 Patch Editing** - DX7 data is preserved but not editable (too complex)
- **Multi-sample Editing** - Multiple sample ranges preserved but not editable
- **Sample Zone Editing** - Start/end points, loop points preserved but not editable
- **MIDI Learn** - MIDI controller mappings preserved but not editable
- **Arpeggiator Patterns** - Basic arp parameters only, no pattern editing
- **Real-time Parameter Updates** - Requires manual patch reload on Deluge (firmware limitation)

## Firmware Compatibility

### Deluge Firmware

| Feature | Official FW 4.0+ | Community FW 1.3+ | Older Firmware |
|---------|------------------|-------------------|----------------|
| **Offline XML Editing** | ✅ Full Support | ✅ Full Support | ✅ Full Support |
| **SYSEX File Transfer** | ✅ Full Support | ✅ Full Support | ❌ Not Available |
| **LFO3/LFO4** | ❌ Not Available | ✅ Supported | ❌ Not Available |
| **Extended Parameters** | Basic | ✅ Full Community Features | Basic |

**If you have older firmware:**
- You can still use the editor for offline XML editing
- All features work except SYSEX file transfer
- Use "Download XML" and copy files to SD card manually

### Browser Compatibility

| Browser | XML Editing | SYSEX Transfer | Notes |
|---------|-------------|----------------|-------|
| **Chrome 90+** | ✅ | ✅ | Recommended |
| **Edge 90+** | ✅ | ✅ | Recommended |
| **Opera 76+** | ✅ | ✅ | Works well |
| **Firefox 88+** | ✅ | ⚠️ | Requires Web MIDI enable in about:config |
| **Safari 14+** | ✅ | ⚠️ | Experimental Web MIDI support |

## Technical Details

### SYSEX Implementation
- Based on [DEx (Deluge Extensions)](https://github.com/silicakes/deluge-extensions) smSysex protocol
- Session management with message ID rotation
- 7-bit binary packing for SYSEX safety
- Pagination support (handles folders with 100+ files)
- Directory caching for performance (30s TTL)
- Automatic filtering of system files (`.DS_Store`, `._*`, etc.)

### XML Parameter Format
- Parameters stored as 32-bit signed integers in hexadecimal (e.g., `0x7FFFFFFF`)
- Range: `0x80000000` (-2,147,483,648) to `0x7FFFFFFF` (2,147,483,647)
- UI automatically converts to user-friendly values
- Supports both old format (nested tags) and new format (attributes)

### Data Preservation
- **Pass-through system** preserves parameters without UI (sample zones, DX7 data, etc.)
- Load → Edit → Save = No data loss for advanced features
- Safe for round-trip editing of complex patches

## Known Limitations

- **No Real-Time Control**: Changes require manually reloading the patch on Deluge (firmware limitation)
- **No LFO3/4 UI**: LFO3 and LFO4 are written to XML and preserved, but there's no UI editor yet
- **Sample Features**: Advanced sample parameters (loop points, time stretch) are preserved but not editable
- **First Load Slow**: Initial directory browsing can take a few seconds with many files (subsequent loads are cached)

## Troubleshooting

### SYSEX Connection Issues
- **Firmware too old?** SYSEX requires Community FW 1.3+ or Official FW 4.0+. You can still use offline XML workflow!
- **Can't connect?** Check USB Port 3 (rightmost port), use Chrome/Edge, grant MIDI permissions
- **Session timeout?** Connection will still work - try browsing or sending a file

### File Browser Issues  
- **Files missing?** Click **"🔄 Refresh"** - directories with 25+ files use pagination
- **Can't see new files?** Refresh the directory after sending files
- **System files showing?** Mac/Windows hidden files (`.DS_Store`, `._*`) are automatically filtered

### Sample/Playback Issues
- **Sample not playing?** Check file path, verify oscillator type is "sample", reload patch on Deluge
- **Can't find sample?** Use 📁 browse button (SYSEX mode) to navigate `/SAMPLES/` folder
- **Wrong pitch?** Check `transpose` and `cents` on oscillator tab

## License

MIT License - This editor is provided as-is for use with the Synthstrom Audible Deluge synthesizer.

## Credits

- Created for the Deluge community
- SYSEX implementation based on [DEx (Deluge Extensions)](https://github.com/silicakes/deluge-extensions) by silicakes
- Complements the [Deluge Community Firmware](https://github.com/SynthstromAudible/DelugeFirmware) project
- Special thanks to the Synthstrom Deluge community for testing and feedback

**Not affiliated with Synthstrom Audible Limited.**

