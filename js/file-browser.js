// Deluge Synth Editor - File Browser
// Preset and sample file browsers, path indicator, notifications
// Huge thanks to silicakes - Michael Katz for the DEx smSysex protocol implementation in https://github.com/silicakes/deluge-extensions
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
    document.getElementById('fileList').innerHTML = '<div class="loading">Hold tight, this can take a while on first go...</div>';

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

