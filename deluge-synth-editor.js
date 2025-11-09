// Deluge Synth Editor JavaScript

// ============================================================================
// SAVE PATH INDICATOR
// ============================================================================

/**
 * Update the save path indicator to show where file will be saved
 */
function updateSavePathIndicator() {
    if (!delugeOutput) {
        return;
    }
    
    const presetName = document.getElementById('presetName').value || 'My Synth';
    const filename = presetName.replace(/[\/\\:*?"<>|]/g, '_').toUpperCase() + '.XML';
    
    let filepath;
    
    if (originalLoadedFilepath) {
        const originalDir = originalLoadedFilepath.substring(0, originalLoadedFilepath.lastIndexOf('/') + 1);
        const originalFilename = originalLoadedFilepath.substring(originalLoadedFilepath.lastIndexOf('/') + 1);
        const nameChanged = originalFilename.toUpperCase() !== filename;
        
        if (nameChanged) {
            filepath = '/SYNTHS/' + filename;
        } else {
            filepath = originalLoadedFilepath;
        }
    } else {
        filepath = '/SYNTHS/' + filename;
    }
    
    document.getElementById('savePathText').textContent = filepath;
}

// Listen for preset name changes
document.addEventListener('DOMContentLoaded', () => {
    const presetNameInput = document.getElementById('presetName');
    if (presetNameInput) {
        presetNameInput.addEventListener('input', updateSavePathIndicator);
    }
});


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
            console.log('Deluge MIDI ports found. Connection ready.');
            
            // Connect directly like DEx does - session will be established on first command
            document.getElementById('connectionStatus').innerHTML =
                '✅ Connected to <strong>' + delugeOutput.name + '</strong>';
            document.getElementById('connectionStatus').style.color = '#4CAF50';
            document.getElementById('connectBtn').textContent = '✅ Connected';
            document.getElementById('connectBtn').disabled = true;
            
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
                console.log('✓ Background ping test succeeded');
            }).catch((err) => {
                console.warn('Background ping test failed (but connection is ready):', err);
            });
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
    
    console.log('Opening smSysex session with tag:', tag);
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
            
            console.log('Session response received:', response);
            
            if (response.json && response.json['^session']) {
                const info = response.json['^session'];
                console.log('Session info:', info);
                currentSession = {
                    sid: info.sid,
                    midMin: info.midMin,
                    midMax: info.midMax,
                    counter: 1
                };
                console.log('✓ Session established successfully:', currentSession);
                resolve(currentSession);
            } else {
                console.error('Invalid session response format:', response);
                reject(new Error('Invalid session response'));
            }
        };
        
        pendingResponses.set(0, responseHandler);
        
        if (delugeOutput) {
            console.log('Sending session request:', Array.from(message.slice(0, 30)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
            console.log('JSON:', jsonData);
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
    console.log('Creating new session...');
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
    console.log('Resetting session');
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
    console.log('MIDI message received:', data.length, 'bytes');

    // Check if it's a SYSEX message
    if (data[0] !== SYSEX_START) {
        return;
    }
    
    console.log('SYSEX message:', Array.from(data.slice(0, 20)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));

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
            console.log('Calling callback for msgId', msgId.toString(16));
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
        console.log('✓ Ping successful');
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
    
    try {
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
        
        return { success: true };
    } catch (error) {
        // Try to close on error
        console.error('Error during write, attempting to close file:', error);
        try {
            await sendJson({ close: { fid } });
        } catch (e) {
            console.error('Failed to close file after error:', e);
        }
        throw error;
    }
}

/**
 * Read a complete file from Deluge with proper chunking
 */
async function readFile(path) {
    console.log('Reading file:', path);
    
    // 1. OPEN
    const openResp = await sendJson({ open: { path, write: 0 } });
    if (!openResp.json['^open']) {
        throw new Error('Failed to open file for reading');
    }
    const { fid, size } = openResp.json['^open'];
    console.log('File opened with fid:', fid, 'size:', size);
    
    try {
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
        
        return result;
    } catch (error) {
        console.error('Error during read, attempting to close file:', error);
        try {
            await sendJson({ close: { fid } });
        } catch (e) {
            console.error('Failed to close file after error:', e);
        }
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
    const allEntries = [];
    let offset = 0;
    const chunkSize = 64; // Request up to 64, but Deluge returns max 25
    let hasMore = true;
    
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
    
    console.log('✓ Loaded', allEntries.length, 'files from', path);
    
    // Cache the result
    directoryCache.set(path, allEntries);
    cacheTimestamp.set(path, Date.now());
    
    return allEntries;
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
    let dirPath = '/SYNTHS/';
    
    if (originalLoadedFilepath) {
        // Extract original directory path
        const originalDir = originalLoadedFilepath.substring(0, originalLoadedFilepath.lastIndexOf('/') + 1);
        const originalFilename = originalLoadedFilepath.substring(originalLoadedFilepath.lastIndexOf('/') + 1);
        
        // Check if name has changed
        const nameChanged = originalFilename.toUpperCase() !== filename;
        
        if (nameChanged) {
            // Name changed - save to root /SYNTHS/ as a new file
            filepath = '/SYNTHS/' + filename;
        } else {
            // Name unchanged - save back to original location
            filepath = originalLoadedFilepath;
            dirPath = originalDir;
        }
    } else {
        // No original file - save to root /SYNTHS/
        filepath = '/SYNTHS/' + filename;
    }

    try {
        // Always check if file exists and ask for confirmation
        showNotification('📤 Checking file...');
        const exists = await fileExists(filepath);
        
        if (exists) {
            // File exists - ask for confirmation
            const overwrite = confirm(
                `"${filename}" already exists at ${dirPath}\n\n` +
                `Click OK to overwrite.\n` +
                `Click Cancel to abort.\n\n` +
                `Tip: Change the preset name to save as a new file.`
            );
            
            if (!overwrite) {
                showNotification('✗ Save cancelled', true);
                return;
            }
        }
        
        showNotification('📤 Sending to Deluge...');
        await writeFile(filepath, xml);
        
        // Send popup notification to Deluge (shows "HELLO SYSEX")
        sendPopupNotification();
        
        // Update the original filepath tracker
        originalLoadedFilepath = filepath;
        
        // Update save path indicator for next save
        updateSavePathIndicator();
        
        showNotification(`✓ Saved to ${filepath} - Reload patch on Deluge to hear changes`);
    } catch (error) {
        console.error('Error sending to Deluge:', error);
        showNotification('✗ Failed: ' + error.message, true);
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

async function loadDirectory(path, forceRefresh = false) {
    currentBrowserPath = path;
    document.getElementById('currentPath').textContent = path;
    document.getElementById('fileList').innerHTML = '<div class="loading">Loading, can take a while on first go...</div>';

    try {
        const entries = await listDirectory(path, forceRefresh);
        renderFileList(entries, path);
    } catch (error) {
        console.error('Error loading directory:', error);
        document.getElementById('fileList').innerHTML =
            '<div class="loading">Error: ' + error.message + '</div>';
    }
}

/**
 * Refresh the current directory (bypass cache)
 */
function refreshDirectory() {
    console.log('🔄 Refresh clicked for:', currentBrowserPath);
    showNotification('🔄 Refreshing directory...');
    loadDirectory(currentBrowserPath, true);
}

/**
 * Filter out system/hidden files (Mac & Windows)
 */
function filterSystemFiles(entries) {
    return entries.filter(entry => {
        const name = entry.name;
        
        // Filter out Mac system files
        if (name.startsWith('._')) return false;  // Resource fork files
        if (name === '.DS_Store') return false;   // Folder metadata
        if (name === '.Spotlight-V100') return false;
        if (name === '.Trashes') return false;
        if (name === '.fseventsd') return false;
        if (name === '.TemporaryItems') return false;
        if (name === '.VolumeIcon.icns') return false;
        
        // Filter out Windows system files
        if (name === 'Thumbs.db') return false;   // Thumbnail cache
        if (name === 'desktop.ini') return false; // Folder settings
        if (name === 'System Volume Information') return false;
        if (name === '$RECYCLE.BIN') return false;
        
        // Filter out any other hidden files (starting with .)
        if (name.startsWith('.')) return false;
        
        return true;
    });
}

function renderFileList(entries, path) {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';

    // Only show parent directory if we're inside /SYNTHS/ subfolders (locked to SYNTHS)
    if (path !== '/SYNTHS/' && path.startsWith('/SYNTHS/')) {
        const parentItem = document.createElement('div');
        parentItem.className = 'file-item folder';
        parentItem.innerHTML = '📁 .. (Parent Directory)';
        parentItem.onclick = () => {
            const parentPath = path.substring(0, path.lastIndexOf('/', path.length - 2) + 1);
            // Ensure we don't go above /SYNTHS/
            if (parentPath.startsWith('/SYNTHS/') || parentPath === '/SYNTHS/') {
                loadDirectory(parentPath);
            }
        };
        fileList.appendChild(parentItem);
    }

    // Filter out system/hidden files
    entries = filterSystemFiles(entries);

    // Sort: directories first, then files
    entries.sort((a, b) => {
        // Check attr field: bit 4 (0x10) = directory
        const aIsDir = (a.attr & 0x10) !== 0;
        const bIsDir = (b.attr & 0x10) !== 0;
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.name.localeCompare(b.name);
    });

    if (entries.length === 0) {
        fileList.innerHTML = '<div class="loading">Empty directory</div>';
        return;
    }

    // Render in batches for better performance
    const BATCH_SIZE = 50;
    let currentIndex = 0;

    function renderBatch() {
        const endIndex = Math.min(currentIndex + BATCH_SIZE, entries.length);
        const fragment = document.createDocumentFragment();

        for (let i = currentIndex; i < endIndex; i++) {
            const entry = entries[i];
            const isDir = (entry.attr & 0x10) !== 0;
            const item = document.createElement('div');
            item.className = 'file-item' + (isDir ? ' folder' : '');

            const icon = isDir ? '📁' : '📄';
            const name = entry.name;

            item.innerHTML = `<span>${icon} ${name}</span>`;

            if (isDir) {
                item.onclick = () => {
                    loadDirectory(path + name + '/');
                };
            } else if (name.toUpperCase().endsWith('.XML')) {
                item.onclick = () => {
                    loadFileFromDeluge(path + name);
                };
            }

            fragment.appendChild(item);
        }

        fileList.appendChild(fragment);
        currentIndex = endIndex;

        // Render next batch if there are more items
        if (currentIndex < entries.length) {
            requestAnimationFrame(renderBatch);
        }
    }

    // Start rendering
    renderBatch();
}

async function loadFileFromDeluge(filepath) {
    try {
        showNotification('📥 Loading from Deluge...');
        closeBrowser();

        const data = await readFile(filepath);
        const xmlContent = new TextDecoder().decode(data);
        
        // Parse and load the XML
        parseXML(xmlContent);
        updateUIFromState();

        const filename = filepath.substring(filepath.lastIndexOf('/') + 1);
        // Just remove the .XML extension, keep the name as-is (including spaces)
        const presetName = filename.replace(/\.XML$/i, '');
        document.getElementById('presetName').value = presetName;
        
        // Store original FULL filepath for preserving directory location
        originalLoadedFilepath = filepath;
        
        // Update save path indicator
        updateSavePathIndicator();

        showNotification(`✓ Loaded: ${filename}`);
    } catch (error) {
        console.error('Error loading from Deluge:', error);
        showNotification('✗ Failed: ' + error.message, true);
    }
}

// ============================================================================
// SAMPLE BROWSER
// ============================================================================

/**
 * Open sample browser for a specific oscillator
 */
function browseSampleForOsc(oscNum) {
    if (!delugeOutput) {
        showNotification('✗ Not connected to Deluge', true);
        return;
    }
    
    currentSampleOscTarget = oscNum;
    document.getElementById('sampleBrowserModal').classList.add('show');
    loadSampleDirectory('/SAMPLES/');
}

/**
 * Close sample browser
 */
function closeSampleBrowser() {
    document.getElementById('sampleBrowserModal').classList.remove('show');
    currentSampleOscTarget = null;
}

/**
 * Load a directory in the sample browser
 */
async function loadSampleDirectory(path, forceRefresh = false) {
    currentSampleBrowserPath = path;
    document.getElementById('sampleCurrentPath').textContent = path;
    document.getElementById('sampleFileList').innerHTML = '<div class="loading">Loading, can take a while on first go...</div>';

    try {
        const entries = await listDirectory(path, forceRefresh);
        renderSampleFileList(entries, path);
    } catch (error) {
        console.error('Error loading sample directory:', error);
        document.getElementById('sampleFileList').innerHTML =
            '<div class="loading">Error: ' + error.message + '</div>';
    }
}

/**
 * Refresh sample directory
 */
function refreshSampleDirectory() {
    console.log('🔄 Sample refresh clicked for:', currentSampleBrowserPath);
    showNotification('🔄 Refreshing samples...');
    loadSampleDirectory(currentSampleBrowserPath, true);
}

/**
 * Render sample file list
 */
function renderSampleFileList(entries, path) {
    const fileList = document.getElementById('sampleFileList');
    fileList.innerHTML = '';

    // Show parent directory if not at SAMPLES root
    if (path !== '/SAMPLES/' && path.startsWith('/SAMPLES/')) {
        const parentItem = document.createElement('div');
        parentItem.className = 'file-item folder';
        parentItem.innerHTML = '📁 .. (Parent Directory)';
        parentItem.onclick = () => {
            const parentPath = path.substring(0, path.lastIndexOf('/', path.length - 2) + 1);
            if (parentPath.startsWith('/SAMPLES/') || parentPath === '/SAMPLES/') {
                loadSampleDirectory(parentPath);
            }
        };
        fileList.appendChild(parentItem);
    }

    // Filter out system files
    entries = filterSystemFiles(entries);

    // Sort: directories first, then files
    entries.sort((a, b) => {
        const aIsDir = (a.attr & 0x10) !== 0;
        const bIsDir = (b.attr & 0x10) !== 0;
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.name.localeCompare(b.name);
    });

    if (entries.length === 0) {
        fileList.innerHTML = '<div class="loading">Empty directory</div>';
        return;
    }

    // Render in batches for performance
    const BATCH_SIZE = 50;
    let currentIndex = 0;

    function renderBatch() {
        const endIndex = Math.min(currentIndex + BATCH_SIZE, entries.length);
        const fragment = document.createDocumentFragment();

        for (let i = currentIndex; i < endIndex; i++) {
            const entry = entries[i];
            const isDir = (entry.attr & 0x10) !== 0;
            const item = document.createElement('div');
            item.className = 'file-item' + (isDir ? ' folder' : '');

            const icon = isDir ? '📁' : '🎵';
            const name = entry.name;

            item.innerHTML = `<span>${icon} ${name}</span>`;

            if (isDir) {
                item.onclick = () => {
                    loadSampleDirectory(path + name + '/');
                };
            } else {
                // Check if it's an audio file
                const audioExtensions = ['.WAV', '.AIFF', '.AIF'];
                if (audioExtensions.some(ext => name.toUpperCase().endsWith(ext))) {
                    item.onclick = () => {
                        selectSampleFile(path + name);
                    };
                }
            }

            fragment.appendChild(item);
        }

        fileList.appendChild(fragment);
        currentIndex = endIndex;

        if (currentIndex < entries.length) {
            requestAnimationFrame(renderBatch);
        }
    }

    renderBatch();
}

/**
 * Select a sample file and populate the oscillator input
 */
function selectSampleFile(filepath) {
    if (!currentSampleOscTarget) {
        return;
    }
    
    // Remove leading slash to make it a relative path
    const relativePath = filepath.startsWith('/') ? filepath.substring(1) : filepath;
    
    const inputId = `osc${currentSampleOscTarget}File`;
    document.getElementById(inputId).value = relativePath;
    
    // Trigger change event to update the parameter
    const event = new Event('input', { bubbles: true });
    document.getElementById(inputId).dispatchEvent(event);
    
    closeSampleBrowser();
    showNotification(`✓ Sample selected: ${relativePath}`);
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
    osc1IsTracking: '1',  // Tracks keyboard pitch (1=yes, 0=no)
    osc1File: '',

    osc2Type: 'square',
    osc2Transpose: '-12',
    osc2Cents: '0',
    osc2RetrigPhase: '-1',
    osc2IsTracking: '1',
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

    // Sidechain/Compressor
    sidechainSend: '0',        // Sidechain send level (sound attribute)
    sidechainSyncLevel: '6',
    sidechainSyncType: '0',
    sidechainAttack: '327244',
    sidechainRelease: '936',
    
    // Clipping
    clippingAmount: '0',
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

// Pass-through storage for parameters we don't have UI for
// This preserves data when loading and re-saving files
let passThroughData = {
    soundAttributes: {},  // Attributes on <sound> tag we don't edit
    osc1Attributes: {},   // Attributes on <osc1> we don't edit
    osc2Attributes: {},   // Attributes on <osc2> we don't edit
    osc1SubTags: '',      // Sub-tags inside <osc1> (like <zone>, <sampleRanges>)
    osc2SubTags: '',      // Sub-tags inside <osc2>
    unknownTags: ''       // Any tags we don't recognize
};

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
    if (currentState.hpfMode) xml += `\n\thpfMode="${currentState.hpfMode}"`;
    if (currentState.filterRoute) xml += `\n\tfilterRoute="${currentState.filterRoute}"`;
    
    // Optional clipping amount
    if (currentState.clippingAmount && currentState.clippingAmount !== '0') {
        xml += `\n\tclippingAmount="${currentState.clippingAmount}"`;
    }
    
    if (currentState.maxVoices !== '8') xml += `\n\tmaxVoices="${currentState.maxVoices}"`;
    xml += '>\n';

    // Oscillator 1
    xml += `\t<osc1\n\t\ttype="${currentState.osc1Type}"`;
    if (currentState.osc1IsTracking !== undefined && currentState.osc1IsTracking !== '1') {
        xml += `\n\t\tisTracking="${currentState.osc1IsTracking}"`;
    }
    xml += `\n\t\ttranspose="${currentState.osc1Transpose}"`;
    xml += `\n\t\tcents="${currentState.osc1Cents}"`;
    xml += `\n\t\tretrigPhase="${currentState.osc1RetrigPhase}"`;
    
    // Add fileName attribute if specified for sample/wavetable
    if (currentState.osc1File && (currentState.osc1Type === 'sample' || currentState.osc1Type === 'wavetable')) {
        xml += `\n\t\tfileName="${currentState.osc1File}"`;
    }
    
    // Add any pass-through attributes we don't have UI for
    for (const [key, value] of Object.entries(passThroughData.osc1Attributes)) {
        xml += `\n\t\t${key}="${value}"`;
    }
    
    xml += ' />\n';

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
    xml += `\n\t\tretrigPhase="${currentState.osc2RetrigPhase}"`;
    
    // Add fileName attribute if specified for sample/wavetable
    if (currentState.osc2File && (currentState.osc2Type === 'sample' || currentState.osc2Type === 'wavetable')) {
        xml += `\n\t\tfileName="${currentState.osc2File}"`;
    }
    
    // Add any pass-through attributes we don't have UI for
    for (const [key, value] of Object.entries(passThroughData.osc2Attributes)) {
        xml += `\n\t\t${key}="${value}"`;
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
    if (currentState.unisonSpread !== '0') {
        xml += ` spread="${currentState.unisonSpread}"`;
    }
    xml += ' />\n';

    // Delay
    xml += `\t<delay\n\t\tpingPong="${currentState.delayPingPong}"`;
    xml += `\n\t\tanalog="${currentState.delayAnalog}"`;
    xml += `\n\t\tsyncLevel="${currentState.delaySyncLevel}"`;
    xml += `\n\t\tsyncType="${currentState.delaySyncType}" />\n`;

    // Sidechain (formerly compressor) - only write if non-default values
    const hasSidechain = currentState.sidechainSyncLevel !== '6' || 
                        currentState.sidechainSyncType !== '0' ||
                        currentState.sidechainAttack !== '327244' ||
                        currentState.sidechainRelease !== '936';
    
    if (hasSidechain) {
        xml += `\t<sidechain\n\t\tsyncLevel="${currentState.sidechainSyncLevel}"`;
        xml += `\n\t\tsyncType="${currentState.sidechainSyncType}"`;
        xml += `\n\t\tattack="${currentState.sidechainAttack}"`;
        xml += `\n\t\trelease="${currentState.sidechainRelease}" />\n`;
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
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    const sound = xmlDoc.querySelector('sound');

    if (!sound) {
        throw new Error('Invalid Deluge synth XML file');
    }
    
    // Clear pass-through data for new file
    passThroughData = {
        soundAttributes: {},
        osc1Attributes: {},
        osc2Attributes: {},
        osc1SubTags: '',
        osc2SubTags: '',
        unknownTags: ''
    };

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
        
        if (osc1.hasAttribute('isTracking')) currentState.osc1IsTracking = osc1.getAttribute('isTracking');

        if (osc1.hasAttribute('fileName')) currentState.osc1File = osc1.getAttribute('fileName');
        
        // Store unknown attributes for pass-through
        const knownAttrs = ['type', 'transpose', 'cents', 'retrigPhase', 'isTracking', 'fileName'];
        for (const attr of osc1.attributes) {
            if (!knownAttrs.includes(attr.name)) {
                passThroughData.osc1Attributes[attr.name] = attr.value;
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
        
        if (osc2.hasAttribute('isTracking')) currentState.osc2IsTracking = osc2.getAttribute('isTracking');

        if (osc2.querySelector('oscillatorSync')) currentState.osc2Sync = osc2.querySelector('oscillatorSync').textContent;
        else if (osc2.hasAttribute('oscillatorSync')) currentState.osc2Sync = osc2.getAttribute('oscillatorSync');

        if (osc2.hasAttribute('fileName')) currentState.osc2File = osc2.getAttribute('fileName');
        
        // Store unknown attributes for pass-through
        const knownAttrs = ['type', 'transpose', 'cents', 'retrigPhase', 'isTracking', 'oscillatorSync', 'fileName'];
        for (const attr of osc2.attributes) {
            if (!knownAttrs.includes(attr.name)) {
                passThroughData.osc2Attributes[attr.name] = attr.value;
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
            'lfo1Rate', 'lfo2Rate', 'lfo3Rate', 'lfo4Rate',
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
        originalLoadedFilepath = null; // Clear since we're starting fresh
        
        // Clear pass-through data
        passThroughData = {
            soundAttributes: {},
            osc1Attributes: {},
            osc2Attributes: {},
            osc1SubTags: '',
            osc2SubTags: '',
            unknownTags: ''
        };
        
        updateUIFromState();
        updateSavePathIndicator();
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

