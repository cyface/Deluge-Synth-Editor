// Deluge Synth Editor JavaScript

// ============================================================================
// EXPERIMENTAL FEATURES TOGGLE
// ============================================================================

function toggleExperimental() {
    const enabled = document.getElementById('experimentalToggle').checked;
    const sysexButtons = document.getElementById('sysexButtons');
    const connectionStatus = document.getElementById('connectionStatus');

    if (enabled) {
        sysexButtons.style.display = 'inline';
        connectionStatus.style.display = 'block';
        showNotification('⚠ SYSEX features enabled (experimental - may not work yet)');
    } else {
        sysexButtons.style.display = 'none';
        connectionStatus.style.display = 'none';
        // Disconnect if connected
        if (delugeOutput) {
            delugeOutput = null;
            delugeInput = null;
            document.getElementById('connectionStatus').innerHTML = 'Not connected to Deluge';
            document.getElementById('connectionStatus').style.color = '#888';
            document.getElementById('connectBtn').textContent = '🔌 Connect to Deluge';
            document.getElementById('connectBtn').disabled = false;
        }
    }
}

// ============================================================================
// WEB MIDI / DELUGE CONNECTION
// ============================================================================

let midiAccess = null;
let delugeOutput = null;
let delugeInput = null;
let sessionId = 0;
let messageId = 0;
let pendingResponses = new Map(); // Map of messageId -> callback
let currentFileId = null;
let currentBrowserPath = '/SYNTHS/';

// Deluge SYSEX manufacturer ID
const SYSEX_START = 0xF0;
const SYSEX_END = 0xF7;
const DELUGE_SYSEX_ID = [0x00, 0x21, 0x7B, 0x01]; // Synthstrom Deluge
const SYSEX_CMD_JSON = 0x05;
const SYSEX_CMD_JSON_REPLY = 0x06;

// Connect to Deluge via Web MIDI (Port 3)
async function connectToDeluge() {
    if (!navigator.requestMIDIAccess) {
        alert('Web MIDI is not supported in your browser.\n\nPlease use Chrome, Edge, or Opera.\n\nFirefox/Safari require enabling Web MIDI in settings.');
        return;
    }

    try {
        console.log('Requesting MIDI access with SYSEX...');
        midiAccess = await navigator.requestMIDIAccess({ sysex: true });

        console.log('Available MIDI outputs:');
        for (const output of midiAccess.outputs.values()) {
            console.log(' -', output.name, output.id, output.manufacturer);
        }

        console.log('Available MIDI inputs:');
        for (const input of midiAccess.inputs.values()) {
            console.log(' -', input.name, input.id, input.manufacturer);
        }

        // Look for Deluge Port 3 (SYSEX port)
        let foundDeluge = false;

        for (const output of midiAccess.outputs.values()) {
            // Port 3 is specifically for SYSEX and usually has "3" or "SYSEX" in the name
            if (output.name.toLowerCase().includes('deluge') &&
                (output.name.includes('3') || output.name.toLowerCase().includes('sysex'))) {
                delugeOutput = output;
                foundDeluge = true;
                console.log('✓ Found Deluge output (Port 3):', output.name);
                break;
            }
        }

        if (!foundDeluge) {
            // Fallback: look for any Deluge port
            for (const output of midiAccess.outputs.values()) {
                if (output.name.toLowerCase().includes('deluge')) {
                    delugeOutput = output;
                    foundDeluge = true;
                    console.log('⚠ Found Deluge output (fallback):', output.name);
                    break;
                }
            }
        }

        for (const input of midiAccess.inputs.values()) {
            if (input.name.toLowerCase().includes('deluge') &&
                (input.name.includes('3') || input.name.toLowerCase().includes('sysex'))) {
                delugeInput = input;
                delugeInput.onmidimessage = handleMidiMessage;
                console.log('✓ Found Deluge input (Port 3):', input.name);
                break;
            }
        }

        if (!delugeInput) {
            // Fallback
            for (const input of midiAccess.inputs.values()) {
                if (input.name.toLowerCase().includes('deluge')) {
                    delugeInput = input;
                    delugeInput.onmidimessage = handleMidiMessage;
                    console.log('⚠ Found Deluge input (fallback):', input.name);
                    break;
                }
            }
        }

        if (delugeOutput && delugeInput) {
            console.log('Testing connection with ping...');

            // Test connection with ping
            try {
                await sendPing();

                document.getElementById('connectionStatus').innerHTML =
                    '✅ Connected to <strong>' + delugeOutput.name + '</strong>';
                document.getElementById('connectionStatus').style.color = '#4CAF50';
                document.getElementById('connectBtn').textContent = '✅ Connected';
                document.getElementById('connectBtn').disabled = true;
                document.getElementById('sendToDelugeBtn').disabled = false;
                document.getElementById('loadFromDelugeBtn').disabled = false;

                showNotification('✓ Connected to Deluge');
            } catch (pingError) {
                console.error('Ping failed:', pingError);

                const response = confirm(
                    'Found Deluge but ping failed (timeout).\n\n' +
                    'REQUIRED: Enable "Dev Sysex" on Deluge:\n' +
                    '  Settings → Community Features → Dev Sysex → ON\n\n' +
                    'After enabling, click OK to connect anyway.\n' +
                    'Click Cancel to abort.\n\n' +
                    '(You can try sending presets - it might work even without ping)'
                );

                if (response) {
                    // Connect anyway
                    document.getElementById('connectionStatus').innerHTML =
                        '⚠️ Connected (no ping) to <strong>' + delugeOutput.name + '</strong>';
                    document.getElementById('connectionStatus').style.color = '#FFA726';
                    document.getElementById('connectBtn').textContent = '⚠️ Connected';
                    document.getElementById('connectBtn').disabled = true;
                    document.getElementById('sendToDelugeBtn').disabled = false;
                    document.getElementById('loadFromDelugeBtn').disabled = false;

                    showNotification('⚠ Connected without ping - try sending a preset');
                } else {
                    delugeOutput = null;
                    delugeInput = null;
                }
            }
        } else {
            let errorMsg = 'Could not find Deluge.\n\nAvailable MIDI devices:\n';
            for (const output of midiAccess.outputs.values()) {
                errorMsg += '  • ' + output.name + '\n';
            }
            errorMsg += '\nMake sure:\n- Deluge is powered on\n- Connected via USB Port 3 (rightmost)\n- Deluge shows up in the list above';
            alert(errorMsg);
        }

    } catch (error) {
        console.error('MIDI Access Error:', error);
        alert('Failed to access MIDI devices:\n' + error.message + '\n\nMake sure you granted MIDI permissions when prompted.');
    }
}

// Handle incoming MIDI messages
function handleMidiMessage(event) {
    const data = event.data;

    // Log ALL incoming MIDI for debugging
    console.log('Received MIDI message:', Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));

    // Check if it's a SYSEX message
    if (data[0] !== SYSEX_START) {
        console.log('Not SYSEX (status byte:', '0x' + data[0].toString(16) + ')');
        return;
    }

    // Check for Deluge manufacturer ID
    if (data[1] !== DELUGE_SYSEX_ID[0] ||
        data[2] !== DELUGE_SYSEX_ID[1] ||
        data[3] !== DELUGE_SYSEX_ID[2] ||
        data[4] !== DELUGE_SYSEX_ID[3]) {
        console.log('Not a Deluge SYSEX message (wrong manufacturer ID)');
        return;
    }

    // Check if it's a JSON reply
    if (data[5] !== SYSEX_CMD_JSON_REPLY) {
        console.log('Not a JSON reply (command byte:', data[5], ')');
        return;
    }

    const msgId = data[6];
    const jsonStart = 7;
    const jsonEnd = data.length - 1; // Exclude F7

    // Decode JSON from SYSEX bytes (it's just ASCII)
    let jsonStr = '';
    for (let i = jsonStart; i < jsonEnd; i++) {
        jsonStr += String.fromCharCode(data[i]);
    }

    console.log('Received JSON (msgId=' + msgId + '):', jsonStr);

    try {
        const response = JSON.parse(jsonStr);

        // Call pending callback if exists
        if (pendingResponses.has(msgId)) {
            console.log('Calling callback for msgId', msgId);
            const callback = pendingResponses.get(msgId);
            callback(response);
            pendingResponses.delete(msgId);
        } else {
            console.log('No pending callback for msgId', msgId);
        }
    } catch (error) {
        console.error('Error parsing JSON response:', error, jsonStr);
    }
}

// Send SYSEX message to Deluge
function sendSysex(jsonPayload, callback) {
    if (!delugeOutput) {
        showNotification('✗ Not connected to Deluge', true);
        return;
    }

    messageId = (messageId + 1) % 256;

    // Build SYSEX message
    const sysexMsg = [
        SYSEX_START,
        ...DELUGE_SYSEX_ID,
        SYSEX_CMD_JSON,
        messageId
    ];

    // Add JSON payload as ASCII bytes
    for (let i = 0; i < jsonPayload.length; i++) {
        sysexMsg.push(jsonPayload.charCodeAt(i));
    }

    sysexMsg.push(SYSEX_END);

    // Log outgoing message
    console.log('Sending SYSEX (msgId=' + messageId + '):',
                Array.from(sysexMsg).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
    console.log('JSON payload:', jsonPayload);

    // Register callback
    if (callback) {
        pendingResponses.set(messageId, callback);
        console.log('Registered callback for msgId', messageId);

        // Timeout after 5 seconds
        setTimeout(() => {
            if (pendingResponses.has(messageId)) {
                console.error('Timeout waiting for response to msgId', messageId);
                pendingResponses.delete(messageId);
                callback({ error: 'Timeout - no response from Deluge' });
            }
        }, 5000);
    }

    // Send to Deluge
    try {
        delugeOutput.send(sysexMsg);
        console.log('✓ SYSEX sent successfully');
    } catch (error) {
        console.error('Error sending SYSEX:', error);
        if (callback) {
            pendingResponses.delete(messageId);
            callback({ error: 'Failed to send: ' + error.message });
        }
    }
}

// Test connection with ping (tries session first)
async function sendPing() {
    console.log('Establishing session with Deluge...');

    // Try to establish a session first
    try {
        await new Promise((resolve, reject) => {
            sendSysex('{"session":{"tag":"deluge-editor"}}', (response) => {
                console.log('Session response:', response);
                if (response && response['^session']) {
                    sessionId = response['^session'].sid || 0;
                    console.log('✓ Session established, ID:', sessionId);
                }
                // Resolve even if session fails - it might not be required
                resolve();
            });
        });
    } catch (sessionError) {
        console.log('Session establishment failed, continuing anyway:', sessionError);
    }

    // Now try ping
    return new Promise((resolve, reject) => {
        console.log('Sending ping to Deluge...');
        sendSysex('{"ping":{}}', (response) => {
            console.log('Ping response:', response);

            if (response && response.error) {
                console.error('Ping error:', response.error);
                reject(new Error(response.error));
            } else if (response && response['^ping']) {
                console.log('✓ Ping successful!');
                resolve();
            } else {
                console.error('Unexpected ping response:', response);
                reject(new Error('Unexpected response from Deluge'));
            }
        });
    });
}

// Get directory listing from Deluge
function getDirectory(path, callback) {
    const json = `{"dir":{"path":"${path}"}}`;
    sendSysex(json, callback);
}

// Open file on Deluge for writing
function openFileForWrite(path, callback) {
    const json = `{"open":{"path":"${path}","write":1}}`;
    sendSysex(json, callback);
}

// Close file on Deluge
function closeFile(fileId, callback) {
    const json = `{"close":{"fid":${fileId}}}`;
    sendSysex(json, callback);
}

// Write data block to file
function writeBlock(fileId, data, callback) {
    // Data needs to be 7-bit encoded for SYSEX
    const encoded = encode7bit(data);
    const json = `{"write":{"fid":${fileId},"size":${data.length}}}`;

    // Create message with separator and encoded data
    const fullMsg = json.substring(0, json.length - 1) + '\0' + encoded + '}';
    sendSysex(fullMsg, callback);
}

// Read file from Deluge
function openFileForRead(path, callback) {
    const json = `{"open":{"path":"${path}","write":0}}`;
    sendSysex(json, callback);
}

function readBlock(fileId, addr, size, callback) {
    const json = `{"read":{"fid":${fileId},"addr":${addr},"size":${size}}}`;
    sendSysex(json, callback);
}

// 7-bit encoding for SYSEX data
function encode7bit(str) {
    const bytes = new TextEncoder().encode(str);
    let result = '';

    for (let i = 0; i < bytes.length; i += 7) {
        let hiBits = 0;
        const chunk = [];

        for (let j = 0; j < 7 && i + j < bytes.length; j++) {
            const byte = bytes[i + j];
            chunk.push(byte & 0x7F);
            if (byte & 0x80) {
                hiBits |= (1 << j);
            }
        }

        result += String.fromCharCode(hiBits);
        for (const b of chunk) {
            result += String.fromCharCode(b);
        }
    }

    return result;
}

// Decode 7-bit encoded data
function decode7bit(encoded) {
    const bytes = [];

    for (let i = 0; i < encoded.length;) {
        const hiBits = encoded.charCodeAt(i++);
        const chunkSize = Math.min(7, encoded.length - i);

        for (let j = 0; j < chunkSize; j++) {
            let byte = encoded.charCodeAt(i++);
            if (hiBits & (1 << j)) {
                byte |= 0x80;
            }
            bytes.push(byte);
        }
    }

    return new TextDecoder().decode(new Uint8Array(bytes));
}

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
    const filename = presetName.replace(/[^a-z0-9]/gi, '_') + '.XML';
    const filepath = '/SYNTHS/' + filename;

    try {
        showNotification('📤 Sending to Deluge...');

        // Open file for writing
        const openResp = await new Promise((resolve) => {
            openFileForWrite(filepath, resolve);
        });

        if (openResp['^open'] && openResp['^open'].fid) {
            const fileId = openResp['^open'].fid;

            // Write XML data in chunks (max 1024 bytes per chunk)
            const chunkSize = 1024;
            let offset = 0;

            while (offset < xml.length) {
                const chunk = xml.substring(offset, offset + chunkSize);

                await new Promise((resolve) => {
                    writeBlock(fileId, chunk, resolve);
                });

                offset += chunkSize;
            }

            // Close file
            await new Promise((resolve) => {
                closeFile(fileId, resolve);
            });

            showNotification(`✓ Sent to Deluge: ${filepath}`);
        } else {
            showNotification('✗ Failed to open file on Deluge', true);
        }

    } catch (error) {
        console.error('Error sending to Deluge:', error);
        showNotification('✗ Error: ' + error.message, true);
    }
}

// ============================================================================
// BROWSE AND LOAD FROM DELUGE
// ============================================================================

function showDelugeBrowser() {
    if (!delugeOutput) {
        showNotification('✗ Not connected to Deluge', true);
        return;
    }

    document.getElementById('browserModal').classList.add('show');
    loadDirectory('/SYNTHS/');
}

function closeBrowser() {
    document.getElementById('browserModal').classList.remove('show');
}

function loadDirectory(path) {
    currentBrowserPath = path;
    document.getElementById('currentPath').textContent = path;
    document.getElementById('fileList').innerHTML = '<div class="loading">Loading...</div>';

    getDirectory(path, (response) => {
        if (response['^dir'] && response['^dir'].entries) {
            renderFileList(response['^dir'].entries, path);
        } else {
            document.getElementById('fileList').innerHTML =
                '<div class="loading">Error loading directory</div>';
        }
    });
}

function renderFileList(entries, path) {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';

    // Add parent directory link if not at root
    if (path !== '/') {
        const parentItem = document.createElement('div');
        parentItem.className = 'file-item folder';
        parentItem.innerHTML = '📁 .. (Parent Directory)';
        parentItem.onclick = () => {
            const parentPath = path.substring(0, path.lastIndexOf('/', path.length - 2) + 1);
            loadDirectory(parentPath || '/');
        };
        fileList.appendChild(parentItem);
    }

    // Sort: directories first, then files
    entries.sort((a, b) => {
        if (a.dir && !b.dir) return -1;
        if (!a.dir && b.dir) return 1;
        return a.name.localeCompare(b.name);
    });

    entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'file-item' + (entry.dir ? ' folder' : '');

        const icon = entry.dir ? '📁' : '📄';
        const name = entry.name;

        item.innerHTML = `<span>${icon} ${name}</span>`;

        if (entry.dir) {
            item.onclick = () => {
                loadDirectory(path + name + '/');
            };
        } else if (name.toUpperCase().endsWith('.XML')) {
            item.onclick = () => {
                loadFileFromDeluge(path + name);
            };
        }

        fileList.appendChild(item);
    });

    if (entries.length === 0) {
        fileList.innerHTML = '<div class="loading">Empty directory</div>';
    }
}

async function loadFileFromDeluge(filepath) {
    try {
        showNotification('📥 Loading from Deluge...');
        closeBrowser();

        // Open file for reading
        const openResp = await new Promise((resolve) => {
            openFileForRead(filepath, resolve);
        });

        if (openResp['^open'] && openResp['^open'].fid) {
            const fileId = openResp['^open'].fid;
            const fileSize = openResp['^open'].size;

            let xmlContent = '';
            let offset = 0;
            const chunkSize = 1024;

            // Read file in chunks
            while (offset < fileSize) {
                const readSize = Math.min(chunkSize, fileSize - offset);

                const readResp = await new Promise((resolve) => {
                    readBlock(fileId, offset, readSize, resolve);
                });

                if (readResp['^read'] && readResp['^read'].data) {
                    // Decode the 7-bit encoded data
                    const decodedChunk = decode7bit(readResp['^read'].data);
                    xmlContent += decodedChunk;
                }

                offset += readSize;
            }

            // Close file
            await new Promise((resolve) => {
                closeFile(fileId, resolve);
            });

            // Parse and load the XML
            parseXML(xmlContent);

            const filename = filepath.substring(filepath.lastIndexOf('/') + 1);
            document.getElementById('presetName').value = filename.replace('.XML', '').replace(/_/g, ' ');

            showNotification(`✓ Loaded from Deluge: ${filename}`);

        } else {
            showNotification('✗ Failed to open file on Deluge', true);
        }

    } catch (error) {
        console.error('Error loading from Deluge:', error);
        showNotification('✗ Error: ' + error.message, true);
    }
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

function showNotification(message, isError = false) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = 'notification show' + (isError ? ' error' : '');

    // Auto-hide after 3 seconds
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// ============================================================================
// PARAMETER DEFINITIONS AND CONVERSIONS
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
    osc1File: '',

    osc2Type: 'square',
    osc2Transpose: '-12',
    osc2Cents: '0',
    osc2RetrigPhase: '-1',
    osc2Sync: '0',
    osc2File: '',

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
    lpfFrequency: '0x7FFFFFFF',
    lpfResonance: '0x80000000',
    lpfMorph: '0x80000000',

    hpfMode: 'HPLadder',
    hpfFrequency: '0x80000000',
    hpfResonance: '0x80000000',
    hpfMorph: '0x80000000',

    filterRoute: 'HPF2LPF',
    waveFold: '0x80000000',

    // LFOs
    lfo1Type: 'triangle',
    lfo1SyncLevel: '0',
    lfo1SyncType: '0',
    lfo1Rate: '0x1999997E',

    lfo2Type: 'triangle',
    lfo2SyncLevel: '0',
    lfo2SyncType: '0',
    lfo2Rate: '0x00000000',

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

    // Sidechain/Compressor
    sidechainSyncLevel: '6',
    sidechainSyncType: '0',
    sidechainAttack: '327244',
    sidechainRelease: '936',
    compressorShape: '0xDC28F5B2',

    // Arpeggiator
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

// Modulation sources and destinations
const modSources = [
    'none', 'lfo1', 'lfo2', 'envelope1', 'envelope2', 'envelope3', 'envelope4',
    'velocity', 'note', 'aftertouch', 'x', 'y',
    'compressor', 'random'
];

const modDestinations = [
    'volume', 'pan', 'pitch',
    'oscAVolume', 'oscAPitch', 'oscAPhaseWidth', 'oscAWavetablePosition',
    'oscBVolume', 'oscBPitch', 'oscBPhaseWidth', 'oscBWavetablePosition',
    'noiseVolume',
    'lpfFrequency', 'lpfResonance',
    'hpfFrequency', 'hpfResonance',
    'lfo1Rate', 'lfo2Rate',
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

// ============================================================================
// KNOB INTERACTION
// ============================================================================

let isDragging = false;
let currentKnob = null;
let startY = 0;
let startValue = 0;

function initializeKnobs() {
    const knobs = document.querySelectorAll('.knob');

    knobs.forEach(knob => {
        const paramName = knob.dataset.param;
        const min = parseFloat(knob.dataset.min);
        const max = parseFloat(knob.dataset.max);

        // Initialize from current state
        if (currentState[paramName]) {
            const uiValue = hexToUI(currentState[paramName], min, max);
            updateKnobDisplay(knob, uiValue, min, max);
        }

        // Mouse events
        knob.addEventListener('mousedown', (e) => {
            isDragging = true;
            currentKnob = knob;
            startY = e.clientY;
            startValue = parseFloat(knob.dataset.value) || 0;
            e.preventDefault();
        });

        // Touch events
        knob.addEventListener('touchstart', (e) => {
            isDragging = true;
            currentKnob = knob;
            startY = e.touches[0].clientY;
            startValue = parseFloat(knob.dataset.value) || 0;
            e.preventDefault();
        });
    });

    // Global mouse move
    document.addEventListener('mousemove', (e) => {
        if (isDragging && currentKnob) {
            const deltaY = startY - e.clientY;
            const sensitivity = 0.5;
            const min = parseFloat(currentKnob.dataset.min);
            const max = parseFloat(currentKnob.dataset.max);
            let newValue = startValue + (deltaY * sensitivity);
            newValue = Math.max(min, Math.min(max, newValue));

            updateKnobDisplay(currentKnob, newValue, min, max);
            updateParameter(currentKnob.dataset.param, newValue, min, max);
        }
    });

    // Global touch move
    document.addEventListener('touchmove', (e) => {
        if (isDragging && currentKnob) {
            const deltaY = startY - e.touches[0].clientY;
            const sensitivity = 0.5;
            const min = parseFloat(currentKnob.dataset.min);
            const max = parseFloat(currentKnob.dataset.max);
            let newValue = startValue + (deltaY * sensitivity);
            newValue = Math.max(min, Math.min(max, newValue));

            updateKnobDisplay(currentKnob, newValue, min, max);
            updateParameter(currentKnob.dataset.param, newValue, min, max);
        }
    });

    // Global mouse up
    document.addEventListener('mouseup', () => {
        isDragging = false;
        currentKnob = null;
    });

    // Global touch end
    document.addEventListener('touchend', () => {
        isDragging = false;
        currentKnob = null;
    });
}

function updateKnobDisplay(knob, value, min, max) {
    knob.dataset.value = value;

    // Calculate rotation (-135 to 135 degrees)
    const normalized = (value - min) / (max - min);
    const degrees = -135 + (normalized * 270);
    knob.style.transform = `rotate(${degrees}deg)`;

    // Update value display
    const paramName = knob.dataset.param;
    const valueDisplay = document.getElementById(paramName + 'Value');
    if (valueDisplay) {
        valueDisplay.textContent = formatDisplayValue(paramName, value);
    }
}

function updateParameter(paramName, uiValue, min = -50, max = 50) {
    currentState[paramName] = uiToHex(uiValue, min, max);

    // If this is an envelope parameter, redraw the envelope in real-time
    if (paramName.startsWith('env')) {
        const envNum = paramName.charAt(3); // Get envelope number (1-4)
        updateEnvelopeDisplay(envNum);
    }
}

// Update a specific envelope display
function updateEnvelopeDisplay(envNum) {
    const sustainMin = envNum === '1' ? 0 : -25;
    const sustainMax = envNum === '1' ? 50 : 25;

    drawEnvelope(
        `env${envNum}Canvas`,
        hexToUI(currentState[`env${envNum}Attack`], 0, 50),
        hexToUI(currentState[`env${envNum}Decay`], 0, 50),
        hexToUI(currentState[`env${envNum}Sustain`], sustainMin, sustainMax),
        hexToUI(currentState[`env${envNum}Release`], 0, 50),
        sustainMin,
        sustainMax
    );
}

// ============================================================================
// TAB NAVIGATION
// ============================================================================

function showTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabName).classList.add('active');

    // Activate corresponding tab button
    event.target.classList.add('active');

    // Redraw envelopes if on envelope tab
    if (tabName === 'envelopes') {
        updateEnvelopeDisplay('1');
        updateEnvelopeDisplay('2');
        updateEnvelopeDisplay('3');
        updateEnvelopeDisplay('4');
    }
}

// ============================================================================
// ENVELOPE VISUALIZATION
// ============================================================================

function drawEnvelope(canvasId, attack, decay, sustain, release, sustainMin = 0, sustainMax = 50) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = canvas.offsetHeight;

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    // Normalize values
    const a = Math.max(0, attack) / 50;
    const d = Math.max(0, decay) / 50;
    // Sustain can be bipolar for mod envelopes
    const sustainRange = sustainMax - sustainMin;
    const s = (Math.max(sustainMin, Math.min(sustainMax, sustain)) - sustainMin) / sustainRange;
    const r = Math.max(0, release) / 50;

    // Scale for drawing
    // Attack/Decay/Release: minimum 2px (nearly vertical), maximum 100px
    const attackTime = a < 0.01 ? 2 : 2 + a * 98;
    const decayTime = d < 0.01 ? 2 : 2 + d * 98;
    const sustainTime = 60;
    const releaseTime = r < 0.01 ? 2 : 2 + r * 98;

    const totalTime = attackTime + decayTime + sustainTime + releaseTime;
    const scale = (width - 40) / totalTime;

    // Draw envelope
    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();

    // Start
    let x = 20;
    let y = height - 20;
    ctx.moveTo(x, y);

    // Attack
    x += attackTime * scale;
    y = 20;
    ctx.lineTo(x, y);

    // Decay
    x += decayTime * scale;
    y = 20 + (1 - s) * (height - 40);
    ctx.lineTo(x, y);

    // Sustain
    x += sustainTime * scale;
    ctx.lineTo(x, y);

    // Release
    x += releaseTime * scale;
    y = height - 20;
    ctx.lineTo(x, y);

    ctx.stroke();

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);

    // Horizontal lines
    for (let i = 1; i < 4; i++) {
        const gridY = 20 + (i / 4) * (height - 40);
        ctx.beginPath();
        ctx.moveTo(20, gridY);
        ctx.lineTo(width - 20, gridY);
        ctx.stroke();
    }

    ctx.setLineDash([]);
}

// ============================================================================
// MODULATION MATRIX
// ============================================================================

function addPatchCable() {
    const cable = {
        source: 'velocity',
        destination: 'volume',
        amount: '0x3FFFFFE8'
    };

    patchCables.push(cable);
    renderPatchCables();
}

function removePatchCable(index) {
    patchCables.splice(index, 1);
    renderPatchCables();
}

function updatePatchCable(index, field, value) {
    if (field === 'amount') {
        // Convert percentage to hex
        const uiValue = parseFloat(value);
        patchCables[index][field] = uiToHex(uiValue, -50, 50);
    } else {
        patchCables[index][field] = value;
    }
}

function renderPatchCables() {
    const container = document.getElementById('patchCablesContainer');
    container.innerHTML = '';

    patchCables.forEach((cable, index) => {
        const row = document.createElement('div');
        row.className = 'mod-row';

        // Source select
        const sourceSelect = document.createElement('select');
        modSources.forEach(source => {
            const option = document.createElement('option');
            option.value = source;
            option.textContent = source.charAt(0).toUpperCase() + source.slice(1);
            if (source === cable.source) option.selected = true;
            sourceSelect.appendChild(option);
        });
        sourceSelect.onchange = (e) => updatePatchCable(index, 'source', e.target.value);

        // Destination select
        const destSelect = document.createElement('select');
        modDestinations.forEach(dest => {
            const option = document.createElement('option');
            option.value = dest;
            option.textContent = dest.charAt(0).toUpperCase() + dest.replace(/([A-Z])/g, ' $1').trim();
            if (dest === cable.destination) option.selected = true;
            destSelect.appendChild(option);
        });
        destSelect.onchange = (e) => updatePatchCable(index, 'destination', e.target.value);

        // Amount slider
        const amountContainer = document.createElement('div');
        amountContainer.style.display = 'flex';
        amountContainer.style.flexDirection = 'column';

        const amountSlider = document.createElement('input');
        amountSlider.type = 'range';
        amountSlider.min = '-50';
        amountSlider.max = '50';
        amountSlider.value = hexToUI(cable.amount, -50, 50).toFixed(0);
        amountSlider.oninput = (e) => updatePatchCable(index, 'amount', e.target.value);

        const amountValue = document.createElement('div');
        amountValue.className = 'slider-value';
        amountValue.textContent = amountSlider.value;
        amountSlider.oninput = (e) => {
            updatePatchCable(index, 'amount', e.target.value);
            amountValue.textContent = e.target.value;
        };

        amountContainer.appendChild(amountSlider);
        amountContainer.appendChild(amountValue);

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.onclick = () => removePatchCable(index);

        row.appendChild(sourceSelect);
        row.appendChild(destSelect);
        row.appendChild(amountContainer);
        row.appendChild(removeBtn);

        container.appendChild(row);
    });
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
    xml += `\n\tmode="${currentState.mode}"`;
    xml += `\n\tlpfMode="${currentState.lpfMode}"`;
    if (currentState.hpfMode) xml += `\n\thpfMode="${currentState.hpfMode}"`;
    xml += `\n\tmodFXType="${currentState.modFXType}"`;
    if (currentState.filterRoute) xml += `\n\tfilterRoute="${currentState.filterRoute}"`;
    if (currentState.maxVoices !== '8') xml += `\n\tmaxVoices="${currentState.maxVoices}"`;
    xml += '>\n';

    // Oscillator 1
    xml += `\t<osc1\n\t\ttype="${currentState.osc1Type}"`;
    xml += `\n\t\ttranspose="${currentState.osc1Transpose}"`;
    xml += `\n\t\tcents="${currentState.osc1Cents}"`;
    xml += `\n\t\tretrigPhase="${currentState.osc1RetrigPhase}"`;

    // Add file if specified for sample/wavetable
    if (currentState.osc1File && (currentState.osc1Type === 'sample' || currentState.osc1Type === 'wavetable')) {
        xml += ` />\n\t\t<osc1 fileName="${currentState.osc1File}"`;
    }
    xml += ' />\n';

    // Oscillator 2
    xml += `\t<osc2\n\t\ttype="${currentState.osc2Type}"`;
    xml += `\n\t\ttranspose="${currentState.osc2Transpose}"`;
    xml += `\n\t\tcents="${currentState.osc2Cents}"`;
    xml += `\n\t\tretrigPhase="${currentState.osc2RetrigPhase}"`;
    if (currentState.osc2Sync === '1') {
        xml += `\n\t\toscillatorSync="${currentState.osc2Sync}"`;
    }

    // Add file if specified for sample/wavetable
    if (currentState.osc2File && (currentState.osc2Type === 'sample' || currentState.osc2Type === 'wavetable')) {
        xml += ` />\n\t\t<osc2 fileName="${currentState.osc2File}"`;
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

    // Sidechain (formerly compressor)
    xml += `\t<sidechain\n\t\tsyncLevel="${currentState.sidechainSyncLevel}"`;
    xml += `\n\t\tsyncType="${currentState.sidechainSyncType}"`;
    xml += `\n\t\tattack="${currentState.sidechainAttack}"`;
    xml += `\n\t\trelease="${currentState.sidechainRelease}" />\n`;

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
    const filename = presetName.replace(/[^a-z0-9]/gi, '_') + '.XML';

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

        if (osc1.hasAttribute('fileName')) currentState.osc1File = osc1.getAttribute('fileName');
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

        if (osc2.querySelector('oscillatorSync')) currentState.osc2Sync = osc2.querySelector('oscillatorSync').textContent;
        else if (osc2.hasAttribute('oscillatorSync')) currentState.osc2Sync = osc2.getAttribute('oscillatorSync');

        if (osc2.hasAttribute('fileName')) currentState.osc2File = osc2.getAttribute('fileName');
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
            'lfo1Rate', 'lfo2Rate',
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
        updateUIFromState();
        showNotification('✓ Reset to default values');
    }
}

// ============================================================================
// RANDOMIZATION
// ============================================================================

function randomizePreset() {
    if (!confirm('Randomize all parameters? This will create a random synth preset.')) {
        return;
    }

    // Helper function to get random value in range
    const randRange = (min, max) => Math.random() * (max - min) + min;
    const randInt = (min, max) => Math.floor(randRange(min, max + 1));
    const randChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // NOTE: General tab is NOT randomized - user keeps their poly/mode/unison settings

    // Oscillators (exclude 'wavetable' and 'sample' as they require file paths)
    const oscTypes = ['sine', 'triangle', 'square', 'analogSquare', 'saw', 'analogSaw'];
    currentState.osc1Type = randChoice(oscTypes);
    currentState.osc1Transpose = randInt(-24, 24).toString();
    currentState.osc2Type = randChoice(oscTypes);
    currentState.osc2Transpose = randInt(-24, 24).toString();
    currentState.osc2Sync = randChoice(['0', '1']);

    // Oscillator levels - ensure at least one is audible
    const osc1Level = randRange(-20, 50);
    const osc2Level = randRange(-20, 50);
    const noiseLevel = randRange(-50, -10);

    // If both oscs are quiet, boost one
    if (osc1Level < -10 && osc2Level < -10) {
        if (Math.random() > 0.5) {
            currentState.oscAVolume = uiToHex(randRange(0, 50), -50, 50);
        } else {
            currentState.oscBVolume = uiToHex(randRange(0, 50), -50, 50);
        }
    } else {
        currentState.oscAVolume = uiToHex(osc1Level, -50, 50);
        currentState.oscBVolume = uiToHex(osc2Level, -50, 50);
    }

    currentState.noiseVolume = uiToHex(noiseLevel, -50, 50);
    currentState.oscAPulseWidth = uiToHex(randRange(-30, 30), -50, 50);
    currentState.oscBPulseWidth = uiToHex(randRange(-30, 30), -50, 50);

    // Master
    currentState.volume = uiToHex(randRange(-10, 30), -50, 50);
    currentState.pan = uiToHex(randRange(-15, 15), -25, 25);
    currentState.portamento = uiToHex(randRange(-40, 10), -50, 50);

    // Envelopes - keep musical
    currentState.env1Attack = uiToHex(randRange(0, 30), 0, 50);
    currentState.env1Decay = uiToHex(randRange(5, 35), 0, 50);
    currentState.env1Sustain = uiToHex(randRange(20, 50), 0, 50);
    currentState.env1Release = uiToHex(randRange(5, 35), 0, 50);

    currentState.env2Attack = uiToHex(randRange(0, 35), 0, 50);
    currentState.env2Decay = uiToHex(randRange(5, 35), 0, 50);
    currentState.env2Sustain = uiToHex(randRange(-15, 15), -25, 25);
    currentState.env2Release = uiToHex(randRange(5, 35), 0, 50);

    currentState.env3Attack = uiToHex(randRange(0, 35), 0, 50);
    currentState.env3Decay = uiToHex(randRange(5, 35), 0, 50);
    currentState.env3Sustain = uiToHex(randRange(-15, 15), -25, 25);
    currentState.env3Release = uiToHex(randRange(5, 35), 0, 50);

    currentState.env4Attack = uiToHex(randRange(0, 35), 0, 50);
    currentState.env4Decay = uiToHex(randRange(5, 35), 0, 50);
    currentState.env4Sustain = uiToHex(randRange(-15, 15), -25, 25);
    currentState.env4Release = uiToHex(randRange(5, 35), 0, 50);

    // Filters
    currentState.lpfMode = randChoice(['12dB', '24dB', '24dBDrive', 'SVF']);
    currentState.lpfFrequency = uiToHex(randRange(10, 50), 0, 50);
    currentState.lpfResonance = uiToHex(randRange(-20, 40), -50, 50);
    currentState.lpfMorph = uiToHex(randRange(-20, 20), -50, 50);

    currentState.hpfMode = randChoice(['12dB', '24dB', 'HPLadder']);
    currentState.hpfFrequency = uiToHex(randRange(-30, 10), 0, 50);
    currentState.hpfResonance = uiToHex(randRange(-30, 20), -50, 50);
    currentState.hpfMorph = uiToHex(randRange(-20, 20), -50, 50);

    currentState.filterRoute = randChoice(['HPF2LPF', 'LPF2HPF', 'PARALLEL', 'H2L']);
    currentState.waveFold = uiToHex(randRange(-40, 10), -50, 50);

    // LFOs
    const lfoTypes = ['sine', 'triangle', 'square', 'saw', 'sampleAndHold'];
    currentState.lfo1Type = randChoice(lfoTypes);
    currentState.lfo1SyncLevel = randInt(0, 9).toString();
    currentState.lfo1Rate = uiToHex(randRange(0, 35), 0, 50);

    currentState.lfo2Type = randChoice(lfoTypes);
    currentState.lfo2SyncLevel = randInt(0, 9).toString();
    currentState.lfo2Rate = uiToHex(randRange(0, 35), 0, 50);

    // Effects
    const modFXTypes = ['none', 'flanger', 'chorus', 'phaser', 'StereoChorus', 'warble'];
    currentState.modFXType = randChoice(modFXTypes);
    if (currentState.modFXType !== 'none') {
        currentState.modFXRate = uiToHex(randRange(0, 35), 0, 50);
        currentState.modFXDepth = uiToHex(randRange(5, 40), 0, 50);
        currentState.modFXOffset = uiToHex(randRange(-20, 20), -50, 50);
        currentState.modFXFeedback = uiToHex(randRange(0, 30), 0, 50);
    }

    currentState.delayRate = uiToHex(randRange(-20, 30), 0, 50);
    currentState.delayFeedback = uiToHex(randRange(-20, 30), 0, 50);
    currentState.reverbAmount = uiToHex(randRange(-30, 20), 0, 50);

    // EQ
    currentState.bass = uiToHex(randRange(-15, 15), -25, 25);
    currentState.treble = uiToHex(randRange(-15, 15), -25, 25);

    // Distortion (keep subtle usually)
    currentState.sampleRateReduction = uiToHex(randRange(-40, 10), 0, 50);
    currentState.bitCrush = uiToHex(randRange(-40, 10), 0, 50);

    // FM parameters (randomize based on current mode setting)
    const currentMode = document.getElementById('mode')?.value || currentState.mode;
    if (currentMode === 'fm') {
        currentState.modulator1Amount = uiToHex(randRange(-10, 40), -50, 50);
        currentState.modulator1Feedback = uiToHex(randRange(-30, 20), -50, 50);
        currentState.modulator2Amount = uiToHex(randRange(-10, 40), -50, 50);
        currentState.modulator2Feedback = uiToHex(randRange(-30, 20), -50, 50);
        currentState.carrier1Feedback = uiToHex(randRange(-30, 20), -50, 50);
        currentState.carrier2Feedback = uiToHex(randRange(-30, 20), -50, 50);
    }

    // Random patch cables (1-4 cables)
    patchCables = [];
    const numCables = randInt(1, 4);
    const usedDestinations = new Set();

    const commonSources = ['lfo1', 'lfo2', 'envelope1', 'envelope2', 'velocity', 'note'];
    const commonDestinations = [
        'volume', 'pan', 'pitch', 'lpfFrequency', 'lpfResonance',
        'hpfFrequency', 'oscAVolume', 'oscBVolume'
    ];

    for (let i = 0; i < numCables; i++) {
        let dest;
        let attempts = 0;
        do {
            dest = randChoice(commonDestinations);
            attempts++;
        } while (usedDestinations.has(dest) && attempts < 20);

        if (!usedDestinations.has(dest)) {
            usedDestinations.add(dest);
            patchCables.push({
                source: randChoice(commonSources),
                destination: dest,
                amount: uiToHex(randRange(-30, 30), -50, 50)
            });
        }
    }

    // Update UI
    updateUIFromState();

    // Generate random name
    const prefixes = ['Random', 'Wild', 'Cosmic', 'Deep', 'Bright', 'Dark', 'Electric', 'Analog', 'Digital', 'Vintage'];
    const suffixes = ['Bass', 'Lead', 'Pad', 'Pluck', 'Arp', 'Keys', 'Bell', 'String', 'Synth', 'Texture'];
    document.getElementById('presetName').value = `${randChoice(prefixes)} ${randChoice(suffixes)} ${randInt(1, 99)}`;
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

    console.log('Deluge Synth Editor initialized!');
});

