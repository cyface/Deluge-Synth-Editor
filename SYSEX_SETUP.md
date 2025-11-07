# Deluge SYSEX Connection Setup Guide

## ⚠️ EXPERIMENTAL FEATURE

The JSON SYSEX file API appears to be **incomplete/non-functional** in current Deluge firmware. The code exists but doesn't respond to messages. This feature is hidden by default in the editor.

**We recommend using the standard workflow:** Download XML → Copy to SD card

**Only proceed if you want to experiment with this feature.**

---

## Quick Setup (if you want to try)

### 1. Hardware Connection
- Connect your Deluge to your computer using **USB Port 3** (rightmost USB port on the back of Deluge)
- Power on the Deluge

### 2. Browser Setup
- Open `deluge-synth-editor.html` in **Chrome** or **Edge** (recommended)
- Other browsers may require additional configuration

### 3. Connect
- Click the **"🔌 Connect to Deluge"** button
- Browser will prompt for MIDI device permission - click **"Allow"**
- Editor will automatically find and connect to Deluge Port 3
- Connection status will show: **"✅ Connected to [Deluge Port Name]"**

### 4. Start Using!
- **📤 Send to Deluge** - Writes XML directly to Deluge SD card
- **📥 Load from Deluge** - Browse and load presets from Deluge

## Troubleshooting

### "Could not find Deluge" Error

**Check:**
1. ✅ Deluge is powered ON
2. ✅ USB cable is connected to **Port 3** (rightmost port)
3. ✅ Using Chrome or Edge browser
4. ✅ Granted MIDI permissions when browser asked

**Try:**
- Unplug and reconnect USB cable
- Refresh the webpage
- Try a different USB cable
- Check Windows Device Manager / macOS System Report to see if Deluge is recognized

### "Web MIDI is not supported" Error

**Solution:** Switch to Chrome, Edge, or Opera browser

**Firefox Users:**
1. Type `about:config` in address bar
2. Search for `midi`
3. Enable `dom.webmidi.enabled`
4. Restart Firefox

**Safari Users:**
1. Enable Develop menu: Preferences → Advanced → "Show Develop menu"
2. Develop → Experimental Features → Web MIDI API
3. Restart Safari

### Connection Works but Can't Send Files

**This might mean the JSON SYSEX API needs the Dev Sysex setting enabled:**

1. On Deluge: Navigate to **Settings → Community Features → Dev Sysex**
2. Turn it **ON**
3. Note the hex key displayed (e.g., "on - 1A2B3C4D")
4. You don't need to enter this key anywhere - just enabling it should allow file operations

**OR** it might be a different firmware version issue. The JSON SYSEX file API is available in Community Firmware c1.0+.

## Technical Details

### SYSEX Message Format

All messages use the Deluge manufacturer ID:
```
F0 00 21 7B 01 05 [msgId] [JSON payload] F7
```

- `F0` = SYSEX start
- `00 21 7B` = Synthstrom manufacturer ID
- `01` = Deluge device ID
- `05` = JSON command
- `[msgId]` = Message sequence number (0-255)
- `[JSON payload]` = JSON-formatted command
- `F7` = SYSEX end

### Supported Commands

- `{"ping":{}}` - Test connection
- `{"open":{"path":"/SYNTHS/test.XML","write":1}}` - Open file for writing
- `{"write":{"fid":1,"size":1024}}[encoded data]` - Write data block
- `{"read":{"fid":1,"addr":0,"size":1024}}` - Read data block
- `{"close":{"fid":1}}` - Close file
- `{"dir":{"path":"/SYNTHS/"}}` - List directory

### Data Encoding

Data is 7-bit encoded to be SYSEX-safe (no bytes > 0x7F except start/end markers).

### USB Port 3

Port 3 is specifically designated for SYSEX communication in the Deluge firmware. It's separate from the MIDI ports used for music performance (Ports 1 & 2).

## Security Note

The JSON SYSEX file API allows reading and writing files on the Deluge SD card. This is a powerful feature - use responsibly!

If you're concerned about security:
1. Only connect when actively transferring files
2. Close the browser tab when done
3. The "Dev Sysex" setting can be turned off when not in use (though it may not be required for file operations)

## Advantages of SYSEX Transfer

✅ **No SD card removal needed**
✅ **Instant preset transfer**
✅ **Browse Deluge's entire SYNTHS folder**
✅ **Load, edit, and save back** in seconds
✅ **Works while Deluge is running**

Perfect for sound design workflows!

