# Deluge SYSEX Connection Setup Guide

## ✅ WORKING FEATURE

The SYSEX file transfer feature is **now fully functional** using the DEx smSysex protocol! You can now:
- 📤 Send presets directly to Deluge (no SD card removal)
- 📥 Browse and load presets from Deluge's SD card
- 🎨 Edit patches live and save them instantly

**Requirements:** Deluge firmware 4.0+ or Community Firmware 1.3+

---

## Quick Setup

### 1. Hardware Connection
- Connect your Deluge to your computer using **USB Port 3** (rightmost USB port on the back of Deluge)
- Power on the Deluge

### 2. Browser Setup
- Open `index.html` in **Chrome** or **Edge** (recommended)
- Other browsers may require additional configuration

### 3. Connect
- Click the **"🔌 Connect to Deluge"** button (visible by default)
- Browser will prompt for MIDI device permission - click **"Allow"**
- Editor will establish a session and test the connection
- Connection status will show: **"✅ Connected to [Deluge Port Name]"**

### 4. Start Using!
- **📤 Send to Deluge** - Writes preset directly to `/SYNTHS/` folder (or subfolders)
- **📥 Load from Deluge** - Browse `/SYNTHS/` folder and load any preset
- **📁 Browse Samples** - Browse buttons appear next to OSC sample inputs
- **No SD card removal needed!** 🎉

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

### Connection Works but Can't Send/Load Files

**Check your firmware version:**

The smSysex protocol is available in:
- **Deluge Firmware 4.0+** (official)
- **Community Firmware 1.3+**

If you're on an older version, you'll need to update your Deluge firmware.

## Technical Details

### SYSEX Message Format (DEx smSysex Protocol)

All messages use the Deluge manufacturer ID:
```
F0 00 21 7B 01 [cmd] [msgId] [JSON payload] [0x00] [7-bit packed binary] F7
```

- `F0` = SYSEX start
- `00 21 7B 01` = Synthstrom Deluge manufacturer ID
- `[cmd]` = Command byte (0x04 = JSON command, 0x05 = JSON reply)
- `[msgId]` = Message ID from session range (e.g., 0x41-0x4F)
- `[JSON payload]` = JSON-formatted command
- `[0x00]` = Separator (only for commands with binary data)
- `[7-bit packed binary]` = Optional binary payload (write/read operations)
- `F7` = SYSEX end

### Session Management

The editor uses proper session management:
1. Establishes session with Deluge on connect
2. Receives message ID range (e.g., 0x41-0x4F)
3. Rotates through message IDs for each command
4. Creates new session after 100 messages

### Supported Commands

- `{"session":{"tag":"DelugeSynthEditor"}}` - Establish session
- `{"ping":{}}` - Test connection
- `{"open":{"path":"/SYNTHS/PRESET.XML","write":1}}` - Open file for writing
- `{"write":{"fid":1,"addr":0,"size":128}}` + binary - Write 128-byte chunk
- `{"open":{"path":"/SYNTHS/PRESET.XML","write":0}}` - Open file for reading
- `{"read":{"fid":1,"addr":0,"size":1024}}` - Read 1024-byte chunk
- `{"close":{"fid":1}}` - Close file
- `{"dir":{"path":"/SYNTHS/"}}` - List directory

### 7-Bit Data Encoding

Binary data is packed into 7-bit format for SYSEX compatibility:
- Every 7 bytes of data becomes 8 bytes in SYSEX
- First byte: MSBs of the next 7 bytes
- Next 7 bytes: Lower 7 bits of each input byte

This allows safe transmission of XML files through MIDI SYSEX.

### USB Port 3

Port 3 is specifically designated for SYSEX communication in the Deluge firmware. It's separate from the MIDI ports used for music performance (Ports 1 & 2).

## Security Note

The SYSEX file API allows reading and writing files on the Deluge SD card in the `/SYNTHS/` folder only. This editor is restricted to synth presets for safety.

Best practices:
1. Only connect when actively transferring files
2. Close the browser tab when done
3. The file browser is locked to `/SYNTHS/` - you cannot access other folders

## Advantages of SYSEX Transfer

✅ **No SD card removal needed** - Stay in creative flow!
✅ **Instant preset transfer** - Send patches in seconds
✅ **Browse /SYNTHS/ folder** - See all your presets at a glance
✅ **Load, edit, and save back** - Live sound design workflow
✅ **Works while Deluge is running** - No need to power down
✅ **Based on DEx protocol** - Battle-tested, reliable implementation

Perfect for sound design workflows!

## Credits

This implementation is based on the excellent [DEx (Deluge Extensions)](https://github.com/silicakes/deluge-extensions) project by silicakes, which pioneered the smSysex protocol support for the Deluge.

