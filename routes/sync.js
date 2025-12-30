import express from 'express';
import path from 'path';
import fetch from "node-fetch";

// Import the singleton instance directly
import onedrive from '../utils/OneDriveStorage.js';

const router = express.Router();

// --- QUEUE SYSTEM FOR SYNC ---
const SyncQueue = {
    queue: [],
    isProcessing: false,

    add(filename, data) {
        // Add to queue
        this.queue.push({ filename, data });
        console.log(`📥 Added to SyncQueue: ${filename} (Queue size: ${this.queue.length})`);

        // Trigger processing if not already running
        if (!this.isProcessing) {
            this.process();
        }
    },

    async process() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const task = this.queue.shift(); // Get first item
        const { filename, data } = task;

        console.log(`🔄 Processing Sync Task: ${filename}`);

        // RETRY LOGIC (Max 3 attempts)
        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await this.performSync(filename, data);
                console.log(`✅ Sync Task Completed: ${filename}`);
                break; // Success -> Exit retry loop
            } catch (err) {
                console.warn(`⚠️ Sync Attempt ${attempt}/${MAX_RETRIES} failed for ${filename}:`, err.message);
                if (attempt === MAX_RETRIES) {
                    console.error(`❌ Sync Task Dropped after ${MAX_RETRIES} attempts: ${filename}`);
                } else {
                    // Wait slightly before retry (exponential backoff-ish)
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }
        }

        // Process next item
        this.process();
    },

    async performSync(filename, newData) {
        // Check availability inside the async task
        if (!global.folderId || !global.driveId) {
            // Maybe try resolving again or just fail?
            // For now, assume initialized or fail.
            if (!onedrive.client) throw new Error("OneDrive client not initialized");
            const ids = await onedrive.getSharedFolderId();
            if (ids) {
                global.driveId = ids.driveId;
                global.folderId = ids.id;
            } else {
                throw new Error("OneDrive shared folder not resolved");
            }
        }

        let existingData = { data: {} };

        // 1. Try to load existing file first
        try {
            const existingFile = await onedrive.getFileByName(filename, global.folderId, global.driveId);
            if (existingFile && existingFile.url) {
                const resp = await fetch(existingFile.url);
                if (resp.ok) {
                    const json = await resp.json();
                    if (json && json.data) {
                        existingData = json;
                    }
                }
            }
        } catch (readErr) {
            console.warn("  ℹ️ Failed to read existing file (creating new?):", readErr.message);
        }

        // 2. MERGE DATA
        Object.assign(existingData.data, newData);

        const content = JSON.stringify({
            data: existingData.data,
            last_updated: new Date().toISOString()
        }, null, 2);

        // 3. SAVE
        const result = await onedrive.saveFile(
            filename,
            content,
            global.folderId,
            global.driveId
        );

        if (!result.success) {
            throw new Error(result.error || "Unknown OneDrive error");
        }
    }
};

// Save progress to OneDrive ({username}.json)
router.post('/sync/save', (req, res) => {
    const { key, data } = req.body;

    if (!key || !data) {
        return res.status(400).json({ error: "Key and data are required" });
    }

    // Sanitize key (e.g., 'kimthi') -> 'kimthi.json'
    const safeKey = path.basename(key).replace(/[^a-z0-9_\-]/gi, '_');
    const filename = `${safeKey}.json`;

    // ADD TO QUEUE & RETURN IMMEDIATELY
    SyncQueue.add(filename, data);

    // Non-blocking response
    res.json({ success: true, message: "Sync request queued" });
});

// Load progress from OneDrive
router.get('/sync/load/:key', async (req, res) => {
    const { key } = req.params;

    if (!key) {
        return res.status(400).json({ error: "Key is required" });
    }

    const safeKey = path.basename(key).replace(/[^a-z0-9_\-]/gi, '_');
    const filename = `${safeKey}.json`;

    try {
        const folderId = global.folderId;
        const driveId = global.driveId;

        const file = await onedrive.getFileByName(filename, folderId, driveId);

        if (file && file.url) {
            const response = await fetch(file.url);
            if (response.ok) {
                const content = await response.json();
                res.json({ success: true, data: content.data });
            } else {
                res.status(404).json({ error: "Sync file empty or corrupted" });
            }
        } else {
            res.status(404).json({ error: "Sync data not found on Cloud" });
        }
    } catch (err) {
        console.error("Error loading progress from OneDrive:", err);
        res.status(500).json({ error: "Failed to load progress from Cloud" });
    }
});

export default router;
