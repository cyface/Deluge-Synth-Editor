// Deluge Synth Editor - SYSEX Core
// Huge thanks to silicakes - Michael Katz for the DEx smSysex protocol implementation in https://github.com/silicakes/deluge-extensions
// ============================================================================
// CONNECTION STATUS ICON
// ============================================================================

function updateConnectionIcon(state) {
    const icon = document.getElementById('delugeConnection');
    const statusText = document.getElementById('connectionStatusText');
    const midiCCWrapper = document.getElementById('midiCCWrapper');
    if (!icon) return;
    
    icon.classList.remove('disconnected', 'connected', 'active');
    icon.classList.add(state);
    
    // Update title and text based on state
    const titles = {
        'disconnected': 'Click to connect to Deluge',
        'connected': 'Connected to Deluge',
        'active': 'Communicating with Deluge...'
    };
    
    const statusTexts = {
        'disconnected': 'Disconnected',
        'connected': 'Connected',
        'active': 'Communicating'
    };
    
    // Show/hide MIDI CC controls based on connection state
    if (midiCCWrapper) {
        midiCCWrapper.style.display = (state === 'connected' || state === 'active') ? 'flex' : 'none';
    }
    
    icon.title = titles[state] || titles['disconnected'];
    if (statusText) {
        statusText.textContent = statusTexts[state] || statusTexts['disconnected'];
    }
}

function showCommIndicator() {
    isActivelyTransmitting = true;
    updateConnectionIcon('active');
    
    // Show communication modal
    const modal = document.getElementById('commModal');
    const modalText = document.getElementById('commModalText');
    if (modal) {
        if (modalText) {
            modalText.textContent = 'Communicating with Deluge...';
        }
        modal.classList.add('active');
    }
}

function hideCommIndicator() {
    isActivelyTransmitting = false;
    updateConnectionIcon(delugeOutput ? 'connected' : 'disconnected');
    
    // Hide communication modal
    const modal = document.getElementById('commModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function toggleDelugeConnection() {
    if (delugeOutput) {
        // Already connected - show info
        showNotification('✓ Already connected to Deluge');
    } else {
        // Not connected - initiate connection
        await connectToDeluge();
    }
}

// ============================================================================
// WEB MIDI / DELUGE CONNECTION
// ============================================================================

let midiAccess = null;
let delugeOutput = null;
let delugeInput = null;
// Add dedicated CC output (prefer Port 2) and listen to all inputs for CC
let delugeCCOutput = null;
let currentSession = null; // {sid, midMin, midMax, counter}
let messagesSentInSession = 0;
let pendingResponses = new Map(); // Map of messageId -> callback
let currentBrowserPath = '/SYNTHS/';
let currentSampleBrowserPath = '/SAMPLES/';
let currentSampleOscTarget = null; // Which oscillator (1 or 2) we're browsing for
let currentSampleBrowserMode = 'sample'; // 'sample' or 'dx7'
let originalLoadedFilepath = null; // Track the full original filepath when loading from Deluge
let directoryCache = new Map(); // Cache directory listings for faster browsing
let cacheTimestamp = new Map(); // Track when cache entries were created
let isActivelyTransmitting = false; // Flag to track active operations
const MAX_MESSAGES_PER_SESSION = 100;
const CACHE_DURATION_MS = 30000; // Cache directory listings for 30 seconds
// Deluge clamps `lines` to MAX_DIR_LINES (smsysex.cpp), so a page shorter than
// this is the last one.
const DELUGE_MAX_DIR_LINES = 25;
// Bytes of file data per write command. The binary payload is 7-bit packed
// (every 7 bytes become 8), so the SysEx sent is roughly
// 48 + chunk + ceil(chunk/7) bytes. 512 is the size the protocol was designed
// around (vuefinder's blockSize), and the ceiling is the firmware's
// MaxSysExLength of 1024 total SysEx bytes (smsysex.cpp) - a 1024-byte chunk
// packs to a ~1220-byte request and is silently dropped, so stay well under.
//
// This was 24 while the firmware dropped inbound SysEx spanning more than one
// 64-byte USB transfer (DelugeFirmware#4762 / fixed by #4633, shipped in
// c1.3.0). Measured on fixed firmware over real USB: 128/256/512-byte chunks
// each wrote a 16KB file with zero short writes and verified byte-for-byte,
// at 12/20/27 KB/s. On pre-fix firmware a request this size fails outright,
// so saves need community firmware 1.3.0 or later - the retry ladder turns
// that into a hard error, and the size check in writeFile still guarantees
// integrity either way.
const WRITE_CHUNK_SIZE = 512;
const WRITE_CHUNK_ATTEMPTS = 5;

// Deluge SYSEX manufacturer ID and commands (DEx smSysex protocol)
const SYSEX_START = 0xF0;
const SYSEX_END = 0xF7;
const STD_MANUFACTURER_ID = [0x00, 0x21, 0x7B, 0x01]; // Synthstrom Deluge
const DEV_MANUFACTURER_ID = [0x7D]; // Developer ID for testing
const SYSEX_CMD_PING = 0x00;
const SYSEX_CMD_JSON = 0x04;  // JSON command (was 0x05)
const SYSEX_CMD_JSON_REPLY = 0x05;  // JSON reply (was 0x06)
const SYSEX_CMD_PONG = 0x7F;

// Connect to Deluge via Web MIDI (Port 3)
async function connectToDeluge() {
    if (!navigator.requestMIDIAccess) {
        alert('Web MIDI is not supported in your browser.\n\nPlease use Chrome, Edge, or Opera.\n\nFirefox/Safari require enabling Web MIDI in settings.');
        return;
    }

    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: true });

        for (const output of midiAccess.outputs.values()) {
        }

        for (const input of midiAccess.inputs.values()) {
        }

        // Look for Deluge Port 3 (SYSEX port)
        let foundDeluge = false;

        for (const output of midiAccess.outputs.values()) {
            // Port 3 is specifically for SYSEX and usually has "3" or "SYSEX" in the name
            if (output.name.toLowerCase().includes('deluge') &&
                (output.name.includes('3') || output.name.toLowerCase().includes('sysex'))) {
                delugeOutput = output;
                foundDeluge = true;
                break;
            }
        }

        if (!foundDeluge) {
            // Fallback: look for any Deluge port
            for (const output of midiAccess.outputs.values()) {
                if (output.name.toLowerCase().includes('deluge')) {
                    delugeOutput = output;
                    foundDeluge = true;
                    break;
                }
            }
        }

        // Prefer a CC output on Port 2 if available (for sending standard CC)
        for (const output of midiAccess.outputs.values()) {
            if (output.name.toLowerCase().includes('deluge') && (output.name.includes('2') || output.name.toLowerCase().includes('port 2'))) {
                delugeCCOutput = output;
                break;
            }
        }

        // Select SYSEX input (typically Port 3)
        for (const input of midiAccess.inputs.values()) {
            if (input.name.toLowerCase().includes('deluge') &&
                (input.name.includes('3') || input.name.toLowerCase().includes('sysex'))) {
                delugeInput = input;
                delugeInput.onmidimessage = handleMidiMessage;
                break;
            }
        }

        // Also listen to all Deluge inputs (Ports 1/2) for incoming CC
        for (const input of midiAccess.inputs.values()) {
            if (input.name.toLowerCase().includes('deluge')) {
                try {
                    input.onmidimessage = handleMidiMessage;
                } catch (_) {}
            }
        }

        if (delugeOutput && delugeInput) {
            
            // Update connection icon
            updateConnectionIcon('connected');
            
            // Connect directly like DEx does - session will be established on first command
            document.getElementById('connectionStatus').innerHTML =
                '✅ Connected to <strong>' + delugeOutput.name + '</strong>';
            document.getElementById('connectionStatus').style.color = '#4CAF50';
            
            // Show the Send and Load buttons
            document.getElementById('sendToDelugeBtn').style.display = 'inline';
            document.getElementById('loadFromDelugeBtn').style.display = 'inline';
            
            // Show sample browse buttons
            document.getElementById('osc1FileBrowse').style.display = 'inline';
            document.getElementById('osc2FileBrowse').style.display = 'inline';
            
            // Show morph folder browse button (if wavetable/sample enabled)
            const morphFolderBtn = document.getElementById('morphBrowseSampleFolder');
            if (morphFolderBtn) {
                morphFolderBtn.style.display = 'inline';
            }
            
            // Show and update save path indicator
            document.getElementById('savePathIndicator').style.display = 'block';
            updateSavePathIndicator();

            showNotification('✓ Connected to Deluge - ready to send/receive files');
        } else {
            let errorMsg = 'Could not find Deluge.\n\nAvailable MIDI devices:\n';
            for (const output of midiAccess.outputs.values()) {
                errorMsg += '  • ' + output.name + '\n';
            }
            errorMsg += '\nMake sure:\n- Deluge is powered on\n- Connected via USB Port \n- Deluge shows up in the list above';
            alert(errorMsg);
        }

    } catch (error) {
        console.error('MIDI Access Error:', error);
        alert('Failed to access MIDI devices:\n' + error.message + '\n\nMake sure you granted MIDI permissions when prompted.');
    }
}

// ============================================================================
// 7-BIT PACKING/UNPACKING FOR SYSEX BINARY DATA
// ============================================================================

/**
 * Packs 8-bit data into 7-bit clean format for SYSEX
 * Every 7 bytes becomes 8 bytes (1 MSB header + 7 data bytes)
 * Based on DEx implementation
 */
function pack8bitTo7bit(dataIn) {
    const result = [];
    let n = 0;
    while (n < dataIn.length) {
        const count = Math.min(7, dataIn.length - n);
        let msbs = 0;
        const dataBytesForGroup = [];
        for (let i = 0; i < count; i++) {
            const byte = dataIn[n + i];
            msbs |= ((byte & 0x80) >> 7) << i; // Extract MSB and position it
            dataBytesForGroup.push(byte & 0x7F); // Keep lower 7 bits
        }
        result.push(msbs);
        result.push(...dataBytesForGroup);
        n += count;
    }
    return new Uint8Array(result);
}

/**
 * Unpacks 7-bit SYSEX data back to 8-bit
 * Reverses the packing process
 */
function unpack7bitTo8bit(dataIn) {
    const result = [];
    let inOffset = 0;
    while (inOffset < dataIn.length) {
        if (dataIn.length < inOffset + 1) break;
        const msbs = dataIn[inOffset++];
        for (let i = 0; i < 7; i++) {
            if (dataIn.length < inOffset + 1) break;
            let byte = dataIn[inOffset++];
            if ((msbs >> i) & 1) {
                byte |= 0x80; // Restore MSB if it was set
            }
            result.push(byte);
        }
    }
    return new Uint8Array(result);
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Build message ID from session
 */
function buildMsgId(session) {
    const range = session.midMax - session.midMin + 1;
    return session.midMin + ((session.counter - 1) % range);
}

/**
 * Increment session counter
 */
function incrementCounter(session) {
    const range = session.midMax - session.midMin + 1;
    session.counter = (session.counter % range) + 1;
}

/**
 * Opens a session with the Deluge
 * Returns: {sid, midMin, midMax, counter}
 */
async function openSession(tag = 'DelugeSynthEditor') {
    if (currentSession) {
        return currentSession;
    }

    // assignSession() runs on the same queued path as every other smSysex
    // command, so the session request can be dropped too - see the note on
    // SEND_ATTEMPT_TIMEOUTS_MS. Resend rather than sitting on one long timeout.
    let lastError = null;

    for (let attempt = 0; attempt < SEND_ATTEMPT_TIMEOUTS_MS.length; attempt++) {
        try {
            return await attemptOpenSession(tag, SEND_ATTEMPT_TIMEOUTS_MS[attempt]);
        } catch (error) {
            lastError = error;
            console.warn('Session negotiation attempt ' + (attempt + 1) + ' failed ('
                + error.message + ')');
        }
    }

    throw lastError;
}

/**
 * A single session negotiation round trip
 */
function attemptOpenSession(tag, timeoutMs) {
    const sessionCmd = { session: { tag } };
    const jsonData = JSON.stringify(sessionCmd);
    const jsonBytes = new TextEncoder().encode(jsonData);

    const message = new Uint8Array([
        SYSEX_START,
        ...STD_MANUFACTURER_ID,
        SYSEX_CMD_JSON,
        0,  // msgId = 0 for session request
        ...jsonBytes,
        SYSEX_END
    ]);

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Session timeout after ' + timeoutMs + 'ms'));
        }, timeoutMs);

        const cleanup = () => {
            pendingResponses.delete(0);
        };

        const responseHandler = (response) => {
            clearTimeout(timeoutId);
            cleanup();


            if (response.json && response.json['^session']) {
                const info = response.json['^session'];
                currentSession = {
                    sid: info.sid,
                    midMin: info.midMin,
                    midMax: info.midMax,
                    counter: 1
                };
                resolve(currentSession);
            } else {
                console.error('Invalid session response format:', response);
                reject(new Error('Invalid session response'));
            }
        };

        pendingResponses.set(0, responseHandler);

        if (delugeOutput) {
            delugeOutput.send(message);
        } else {
            cleanup();
            reject(new Error('MIDI output not available'));
        }
    });
}

/**
 * Ensure we have a valid session (or create a fallback)
 */
async function ensureSession() {
    if (currentSession && messagesSentInSession < MAX_MESSAGES_PER_SESSION) {
        return currentSession;
    }
    
    // Try to create new session
    currentSession = null;
    messagesSentInSession = 0;
    
    try {
        return await openSession();
    } catch (error) {
        console.warn('Session negotiation failed, using fallback mode:', error);
        // Fallback: Create a simple session without negotiation.
        // The firmware encodes msgId as (sid << 3) + (1..7), so a fallback range
        // must stay inside a single sid block and skip the (sid << 3) + 0 value,
        // otherwise we emit message IDs the Deluge treats as malformed.
        currentSession = {
            sid: 15,
            midMin: 0x79,  // (15 << 3) + 1
            midMax: 0x7F,  // (15 << 3) + 7
            counter: 1
        };
        return currentSession;
    }
}

/**
 * Reset the current session
 */
function resetSession() {
    currentSession = null;
    messagesSentInSession = 0;
}

// ============================================================================
// MIDI MESSAGE HANDLING
// ============================================================================

// Handle incoming MIDI messages
function handleMidiMessage(event) {
    const data = new Uint8Array(event.data);

    // Handle standard MIDI CC (status 0xB0-0xBF)
    const status = data[0] & 0xF0;
    if (status === 0xB0 && data.length >= 3) {
        const controller = data[1];
        const value = data[2];
        if (typeof handleIncomingCC === 'function') {
            try {
                handleIncomingCC(controller, value);
            } catch (e) {
                console.error('Error handling incoming CC:', e);
            }
        }
        // Do not return; some devices may wrap CC in SYSEX too
    }

    // Log all SYSEX for debugging

    // Check if it's a SYSEX message
    if (data[0] !== SYSEX_START) {
        return;
    }
    

    // Determine manufacturer ID type (standard or dev)
    const isDevId = data[1] === 0x7D;
    const manufacturerIdSize = isDevId ? 1 : 4;
    const headerSize = 1 + manufacturerIdSize + 1 + 1; // F0 + mfr + cmd + msgId
    
    // Check for Deluge manufacturer ID
    if (!isDevId) {
        if (data[1] !== STD_MANUFACTURER_ID[0] ||
            data[2] !== STD_MANUFACTURER_ID[1] ||
            data[3] !== STD_MANUFACTURER_ID[2] ||
            data[4] !== STD_MANUFACTURER_ID[3]) {
            return;
        }
    }

    const commandPos = isDevId ? 2 : 5;
    const msgIdPos = isDevId ? 3 : 6;

    const command = data[commandPos];
    const msgId = data[msgIdPos];

    // Check if it's a JSON reply.
    // The Deluge answers most commands with JsonReply (0x05), but the session
    // handshake reply (^session) is sent via startDirect(), which uses the plain
    // Json command byte (0x04) with msgId 0 instead. Accept that one case too or
    // session negotiation never completes. assignSession() is the only caller of
    // startDirect(); see smsysex.cpp startDirect()/startReply() in the firmware.
    // Requests we send also use 0x04, so keep the exception pinned to msgId 0 -
    // otherwise an echoed request could be mistaken for a reply.
    const isReply = command === SYSEX_CMD_JSON_REPLY
        || (command === SYSEX_CMD_JSON && msgId === 0);
    if (!isReply) {
        return;
    }
    const sysexEnd = data.lastIndexOf(SYSEX_END);
    
    if (sysexEnd === -1) {
        console.error('Invalid SYSEX: missing terminator');
        return;
    }
    
    // Find 0x00 separator between JSON and binary data
    let separatorIdx = -1;
    for (let i = headerSize; i < sysexEnd; i++) {
        if (data[i] === 0x00) {
            separatorIdx = i;
            break;
        }
    }
    
    // Extract JSON part
    const jsonBytes = data.slice(headerSize, separatorIdx !== -1 ? separatorIdx : sysexEnd);
    const jsonText = new TextDecoder().decode(jsonBytes);
    
    console.log('Received JSON (msgId=' + msgId.toString(16) + '):', jsonText);
    
    try {
        const json = JSON.parse(jsonText);
        
        // Extract binary data if present
        let binaryData = null;
        if (separatorIdx !== -1) {
            const packedBinary = data.slice(separatorIdx + 1, sysexEnd);
            binaryData = unpack7bitTo8bit(packedBinary);
            console.log('Received binary data:', binaryData.length, 'bytes');
        }
        
        const response = { json, binaryData };
        
        // Call pending callback if exists
        if (pendingResponses.has(msgId)) {
            const callback = pendingResponses.get(msgId);
            pendingResponses.delete(msgId);
            callback(response);
        } else {
            console.warn('Received reply with no pending handler (msgId=' + msgId.toString(16) + '):', jsonText);
        }
    } catch (error) {
        console.error('Error parsing SYSEX response:', error, jsonText);
    }
}

// ============================================================================
// SEND JSON COMMANDS
// ============================================================================

/**
 * Per-attempt timeouts for sendJson, in milliseconds.
 *
 * Processed requests reply fast - measured 4-30ms with no slow tail, even for
 * 2KB replies - so a missing reply after the first rung almost always means
 * the request itself was lost. Every command addresses an explicit
 * fid/addr/offset, so resending is idempotent and safe.
 *
 * On firmware with the USB fix (#4633, c1.3.0+) drops are rare, so this is a
 * short ladder: a couple of quick resends for the odd lost request, then a
 * patient tail for operations that may genuinely be slow on the card
 * (open/close/flush on a large file). Malformed or oversized requests are
 * still dropped without a reply on stock firmware (DelugeFirmware#4762
 * defect 2), and pre-#4633 firmware drops most requests over 48 bytes - the
 * ladder turns both into a clean hard error instead of a hang. The deep
 * 25-rung ladder that lived here while #4762 was unfixed is documented in
 * docs/deluge-sysex-reliability.md.
 */
const SEND_ATTEMPT_TIMEOUTS_MS = [
    400, 400, 800,
    2000, 4000, 10000
];

/**
 * Send JSON command with optional binary payload
 * Automatically manages session and message IDs, and resends dropped commands
 */
async function sendJson(cmd, binaryPayload = null) {
    if (!delugeOutput) {
        throw new Error('Not connected to Deluge');
    }

    let lastError = null;

    for (let attempt = 0; attempt < SEND_ATTEMPT_TIMEOUTS_MS.length; attempt++) {
        // Take a fresh message ID per attempt, so a late reply to an abandoned
        // attempt can never be mistaken for the reply to this one.
        const session = await ensureSession();
        const msgId = buildMsgId(session);
        incrementCounter(session);
        messagesSentInSession++;

        const attemptLabel = attempt > 0 ? ' (retry ' + attempt + ')' : '';
        console.log('sendJson:', cmd, 'msgId=' + msgId.toString(16) + attemptLabel);

        const jsonData = JSON.stringify(cmd);
        const jsonBytes = new TextEncoder().encode(jsonData);

        let message;
        if (cmd.write && binaryPayload) {
            // Write command with binary data
            const packedBinary = pack8bitTo7bit(binaryPayload);
            message = new Uint8Array([
                SYSEX_START,
                ...STD_MANUFACTURER_ID,
                SYSEX_CMD_JSON,
                msgId,
                ...jsonBytes,
                0x00,  // Separator between JSON and binary
                ...packedBinary,
                SYSEX_END
            ]);
            console.log('Sending write with', binaryPayload.length, 'bytes binary data');
        } else {
            // JSON only
            message = new Uint8Array([
                SYSEX_START,
                ...STD_MANUFACTURER_ID,
                SYSEX_CMD_JSON,
                msgId,
                ...jsonBytes,
                SYSEX_END
            ]);
        }

        const timeoutMs = SEND_ATTEMPT_TIMEOUTS_MS[attempt];

        try {
            return await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    pendingResponses.delete(msgId);
                    reject(new Error('No reply to msgId ' + msgId.toString(16)
                        + ' after ' + timeoutMs + 'ms'));
                }, timeoutMs);

                pendingResponses.set(msgId, (response) => {
                    clearTimeout(timeoutId);
                    resolve(response);
                });

                delugeOutput.send(message);
            });
        } catch (error) {
            lastError = error;
            // A single lost request can still happen, so only get loud once
            // the resends stop looking routine.
            const notice = attempt >= 2 ? console.warn : console.log;
            notice('Deluge did not answer ' + Object.keys(cmd).join(',')
                + ' (' + error.message + ') - resending');
        }
    }

    throw new Error('Command failed after ' + SEND_ATTEMPT_TIMEOUTS_MS.length
        + ' attempts. Check Deluge connection. (' + lastError.message + ')');
}

/**
 * Test connection with ping
 */
async function ping() {
    const session = await ensureSession();
    const response = await sendJson({ ping: {} });
    if (response.json['^ping']) {
        return true;
    }
    throw new Error('Invalid ping response');
}

/**
 * Send popup notification to Deluge (shows "HELLO SYSEX" message)
 */
async function sendPopupNotification() {
    if (!delugeOutput) {
        return;
    }
    
    try {
        // Send Popup command (0x01) - shows hardcoded "HELLO SYSEX" on Deluge display
        const message = new Uint8Array([
            SYSEX_START,
            ...STD_MANUFACTURER_ID,
            0x01,  // Popup command
            SYSEX_END
        ]);
        
        delugeOutput.send(message);
        console.log('Sent popup notification to Deluge');
    } catch (error) {
        console.error('Failed to send popup notification:', error);
    }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Write a complete file to Deluge with proper chunking
 */
async function writeFile(path, data) {
    showCommIndicator();
    
    try {
        // Convert string to bytes if needed
        const bytes = typeof data === 'string' 
            ? new TextEncoder().encode(data) 
            : data;
        
        console.log('Writing file:', path, '(', bytes.length, 'bytes)');
        
        // 1. OPEN
        const openResp = await sendJson({ open: { path, write: 1 } });
        if (!openResp.json['^open']) {
            throw new Error('Failed to open file for writing');
        }
        const fid = openResp.json['^open'].fid;
        console.log('File opened with fid:', fid);
        
        // 2. WRITE in chunks
        let offset = 0;

        while (offset < bytes.length) {
            const size = Math.min(WRITE_CHUNK_SIZE, bytes.length - offset);
            const chunk = bytes.slice(offset, offset + size);

            console.log('Writing chunk:', offset, '-', offset + size);

            let written = 0;

            for (let attempt = 0; attempt < WRITE_CHUNK_ATTEMPTS; attempt++) {
                const writeResp = await sendJson(
                    { write: { fid, addr: offset, size: chunk.length } },
                    chunk  // Binary payload
                );

                const ack = writeResp.json['^write'];
                if (!ack) {
                    throw new Error('Write failed: malformed response from Deluge');
                }

                if (ack.err !== 0) {
                    const errCode = ack.err;
                    let errMsg = 'Write error: ' + errCode;

                    // Provide helpful error messages for common error codes
                    if (errCode === 9) {
                        errMsg = 'Write failed: No SD card detected or SD card is write-protected. Please check your SD card and try again.';
                    } else if (errCode === 2) {
                        errMsg = 'Write failed: File not found or permission denied.';
                    } else if (errCode === 5) {
                        errMsg = 'Write failed: SD card is full or out of space.';
                    }

                    throw new Error(errMsg);
                }

                // A short write is NOT reported as an error by the firmware.
                // writeBlock() writes however many bytes survived the transfer
                // and still replies err=0, echoing the real count in `size`.
                // If part of the request was lost in transit the Deluge happily
                // commits a partial chunk, so this MUST be checked - otherwise
                // the file ends up holed with zeros and only fails later, when
                // the Deluge tries to load it (E365).
                written = ack.size;
                if (written === chunk.length) {
                    break;
                }

                console.warn('Short write at offset ' + offset + ': Deluge stored '
                    + written + ' of ' + chunk.length + ' bytes - retrying chunk');
            }

            if (written !== chunk.length) {
                throw new Error('Write failed at offset ' + offset + ': Deluge only stored '
                    + written + ' of ' + chunk.length + ' bytes after '
                    + WRITE_CHUNK_ATTEMPTS + ' attempts. File not written.');
            }

            offset += size;
        }
        
        // 3. CLOSE
        console.log('Closing file...');
        const closeResp = await sendJson({ close: { fid } });
        
        // Check close response for errors
        if (closeResp.json['^close'] && closeResp.json['^close'].err !== 0) {
            throw new Error('Close error: ' + closeResp.json['^close'].err + ' - File may not be fully written!');
        }
        
        console.log('File closed successfully');
        
        // Clear cache for this directory to ensure fresh listing
        const dirPath = path.substring(0, path.lastIndexOf('/') + 1);
        clearDirectoryCache(dirPath);
        
        // Delay to ensure SD card flush (Deluge filesystem needs time, especially on slower SD cards)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verify by reading the file back and comparing every byte.
        // Checking only that the file exists is not enough: the Deluge will
        // happily create a correctly named, correctly sized file whose contents
        // are partly zeros, and the damage only surfaces when it fails to load.
        console.log('Verifying file contents...');
        const readBack = await readFile(path, { silent: true });

        if (readBack.length !== bytes.length) {
            throw new Error('Verification failed: wrote ' + bytes.length
                + ' bytes but read back ' + readBack.length + '. File is corrupt on the SD card.');
        }

        for (let i = 0; i < bytes.length; i++) {
            if (readBack[i] !== bytes[i]) {
                throw new Error('Verification failed: file differs from what was sent, first at byte '
                    + i + '. File is corrupt on the SD card.');
            }
        }

        console.log('File written and verified byte-for-byte:', path);
        
        hideCommIndicator();
        return { success: true };
    } catch (error) {
        hideCommIndicator();
        console.error('Error during write:', error);
        throw error;
    }
}

/**
 * Read a complete file from Deluge with proper chunking
 */
async function readFile(path, { silent = false } = {}) {
    // `silent` is for callers that are already inside their own comm indicator
    // (writeFile's read-back verification), so it isn't dismissed early.
    if (!silent) {
        showCommIndicator();
    }

    try {
        console.log('Reading file:', path);
        
        // 1. OPEN
        const openResp = await sendJson({ open: { path, write: 0 } });
        if (!openResp.json['^open']) {
            throw new Error('Failed to open file for reading');
        }
        const { fid, size } = openResp.json['^open'];
        console.log('File opened with fid:', fid, 'size:', size);
        // 2. READ in 1024-byte chunks
        const result = new Uint8Array(size);
        const chunkSize = 1024;
        let offset = 0;
        
        while (offset < size) {
            const readSize = Math.min(chunkSize, size - offset);
            
            console.log('Reading chunk:', offset, '-', offset + readSize);
            
            const readResp = await sendJson({ 
                read: { fid, addr: offset, size: readSize } 
            });
            
            if (!readResp.binaryData) {
                throw new Error('No data received in read response');
            }
            
            const chunk = readResp.binaryData;
            result.set(chunk, offset);
            offset += chunk.length;
        }
        
        // 3. CLOSE
        console.log('Closing file...');
        await sendJson({ close: { fid } });
        console.log('File read successfully');
        
        if (!silent) {
            hideCommIndicator();
        }
        return result;
    } catch (error) {
        if (!silent) {
            hideCommIndicator();
        }
        console.error('Error during read:', error);
        throw error;
    }
}

/**
 * List directory contents (with caching and pagination)
 * Note: Deluge returns max 25 entries per request, so we need to paginate
 */
async function listDirectory(path, forceRefresh = false) {
    // If force refresh, clear cache for this path first
    if (forceRefresh) {
        console.log('Force refresh - clearing cache for:', path);
        directoryCache.delete(path);
        cacheTimestamp.delete(path);
    }
    
    // Check cache first
    if (directoryCache.has(path)) {
        const cacheTime = cacheTimestamp.get(path);
        const now = Date.now();
        
        if (now - cacheTime < CACHE_DURATION_MS) {
            console.log('Using cached directory listing for:', path, '(' + directoryCache.get(path).length + ' entries)');
            return directoryCache.get(path);
        } else {
            console.log('Cache expired for:', path);
        }
    }
    
    // Fetch with pagination (Deluge has 25 entry limit per request)
    console.log('Fetching directory listing with pagination:', path);
    
    // Only show indicator if not already active
    if (!isActivelyTransmitting) {
        showCommIndicator();
    }
    
    const allEntries = [];
    let offset = 0;
    const chunkSize = DELUGE_MAX_DIR_LINES;
    let hasMore = true;

    try {
        while (hasMore) {
        const resp = await sendJson({ dir: { path, offset, lines: chunkSize } });

        if (!resp.json['^dir']) {
            console.error('Invalid directory response - no ^dir key. Response:', resp.json);
            throw new Error('Invalid directory response');
        }

        const entries = resp.json['^dir'].list || [];

        if (entries.length > 0) {
            allEntries.push(...entries);
            offset += entries.length;
            // A short page means we hit the end of the directory. Stop here
            // rather than spending another round trip just to be told the
            // next page is empty.
            hasMore = entries.length >= DELUGE_MAX_DIR_LINES;
        } else {
            hasMore = false;
        }
        
        // Check for error
        if (resp.json['^dir'].err) {
            console.error('Directory listing error code:', resp.json['^dir'].err);
            break;
        }
        
        // Safety check
        if (offset > 10000) {
            console.warn('Directory has over 10000 entries, stopping');
            break;
        }
        }
        
        
        // Cache the result
        directoryCache.set(path, allEntries);
        cacheTimestamp.set(path, Date.now());
        
        hideCommIndicator();
        return allEntries;
    } catch (error) {
        hideCommIndicator();
        throw error;
    }
}

/**
 * Clear directory cache (call after writing files)
 */
function clearDirectoryCache(path = null) {
    if (path) {
        directoryCache.delete(path);
        cacheTimestamp.delete(path);
        console.log('Cleared cache for:', path);
    } else {
        directoryCache.clear();
        cacheTimestamp.clear();
        console.log('Cleared all directory cache');
    }
}

/**
 * Check if a file exists on Deluge
 */
async function fileExists(filepath) {
    try {
        const dirPath = filepath.substring(0, filepath.lastIndexOf('/') + 1);
        const filename = filepath.substring(filepath.lastIndexOf('/') + 1);
        
        const entries = await listDirectory(dirPath);
        
        // Check if any entry matches the filename (case-insensitive)
        return entries.some(entry => 
            entry.name.toUpperCase() === filename.toUpperCase()
        );
    } catch (error) {
        console.error('Error checking file existence:', error);
        return false;
    }
}

/**
 * Create a folder on Deluge (if supported by firmware)
 */
async function createFolder(path) {
    try {
        showCommIndicator();
        console.log('Creating folder:', path);
        
        const response = await sendJson({ mkdir: { path } });
        
        hideCommIndicator();
        
        if (response.json['^mkdir']) {
            if (response.json['^mkdir'].err === 0) {
                console.log('Folder created successfully:', path);
                clearDirectoryCache(); // Clear cache to refresh listings
                return { success: true };
            } else {
                throw new Error('mkdir error: ' + response.json['^mkdir'].err);
            }
        }
        
        throw new Error('Invalid mkdir response');
    } catch (error) {
        hideCommIndicator();
        console.error('Error creating folder:', error);
        throw error;
    }
}
