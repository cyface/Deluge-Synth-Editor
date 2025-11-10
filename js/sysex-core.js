// Deluge Synth Editor - SYSEX Core
// Huge thanks to silicakes - Michael Katz for the DEx smSysex protocol implementation in https://github.com/silicakes/deluge-extensions
// ============================================================================
// CONNECTION STATUS ICON
// ============================================================================

function updateConnectionIcon(state) {
    const icon = document.getElementById('delugeConnection');
    const statusText = document.getElementById('connectionStatusText');
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
    
    icon.title = titles[state] || titles['disconnected'];
    if (statusText) {
        statusText.textContent = statusTexts[state] || statusTexts['disconnected'];
    }
}

function showCommIndicator() {
    updateConnectionIcon('active');
}

function hideCommIndicator() {
    updateConnectionIcon(delugeOutput ? 'connected' : 'disconnected');
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
const MAX_MESSAGES_PER_SESSION = 100;
const CACHE_DURATION_MS = 30000; // Cache directory listings for 30 seconds

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

        for (const input of midiAccess.inputs.values()) {
            if (input.name.toLowerCase().includes('deluge') &&
                (input.name.includes('3') || input.name.toLowerCase().includes('sysex'))) {
                delugeInput = input;
                delugeInput.onmidimessage = handleMidiMessage;
                break;
            }
        }

        if (!delugeInput) {
            // Fallback
            for (const input of midiAccess.inputs.values()) {
                if (input.name.toLowerCase().includes('deluge')) {
                    delugeInput = input;
                    delugeInput.onmidimessage = handleMidiMessage;
                    break;
                }
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
            
            // Show and update save path indicator
            document.getElementById('savePathIndicator').style.display = 'block';
            updateSavePathIndicator();

            showNotification('✓ Connected to Deluge - ready to send/receive files');
            
            // Optional: Test connection in background (non-blocking)
            ping().then(() => {
            }).catch((err) => {
                console.warn('Background ping test failed (but connection is ready):', err);
            });
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
            console.warn('Session negotiation timed out after 15 seconds - will use fallback mode');
            reject(new Error('Session timeout'));
        }, 15000);
        
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
        // Fallback: Create a simple session without negotiation
        // This works with older firmware or when session protocol is not available
        currentSession = {
            sid: 0,
            midMin: 0x41,  // Use default message ID range
            midMax: 0x4F,
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
    
    // Check if it's a JSON reply
    if (data[commandPos] !== SYSEX_CMD_JSON_REPLY) {
        return;
    }

    const msgId = data[msgIdPos];
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
        }
    } catch (error) {
        console.error('Error parsing SYSEX response:', error, jsonText);
    }
}

// ============================================================================
// SEND JSON COMMANDS
// ============================================================================

/**
 * Send JSON command with optional binary payload
 * Automatically manages session and message IDs
 */
async function sendJson(cmd, binaryPayload = null) {
    if (!delugeOutput) {
        throw new Error('Not connected to Deluge');
    }
    
    const session = await ensureSession();
    const msgId = buildMsgId(session);
    incrementCounter(session);
    messagesSentInSession++;
    
    console.log('sendJson:', cmd, 'msgId=' + msgId.toString(16));
    
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
    
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingResponses.delete(msgId);
            reject(new Error('Command timeout (10s). Check Deluge connection.'));
        }, 10000);
        
        pendingResponses.set(msgId, (response) => {
            clearTimeout(timeoutId);
            resolve(response);
        });
        
        delugeOutput.send(message);
    });
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
        
        // 2. WRITE in 128-byte chunks
        const chunkSize = 128;
        let offset = 0;
        
        while (offset < bytes.length) {
            const size = Math.min(chunkSize, bytes.length - offset);
            const chunk = bytes.slice(offset, offset + size);
            
            console.log('Writing chunk:', offset, '-', offset + size);
            
            const writeResp = await sendJson(
                { write: { fid, addr: offset, size: chunk.length } },
                chunk  // Binary payload
            );
            
            if (writeResp.json['^write'] && writeResp.json['^write'].err !== 0) {
                throw new Error('Write error: ' + writeResp.json['^write'].err);
            }
            
            offset += size;
        }
        
        // 3. CLOSE
        console.log('Closing file...');
        await sendJson({ close: { fid } });
        console.log('File written successfully');
        
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
async function readFile(path) {
    showCommIndicator();
    
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
        
        hideCommIndicator();
        return result;
    } catch (error) {
        hideCommIndicator();
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
    showCommIndicator();
    
    const allEntries = [];
    let offset = 0;
    const chunkSize = 64; // Request up to 64, but Deluge returns max 25
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
            hasMore = entries.length > 0;
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

