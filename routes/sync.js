import express from 'express';
import path from 'path';
import fetch from "node-fetch";

// Import the singleton instance directly
import onedrive from '../utils/OneDriveStorage.js';

const router = express.Router();

// Save progress to OneDrive ({username}.json)
router.post('/sync/save', async (req, res) => {
    const { key, data } = req.body;

    if (!key || !data) {
        return res.status(400).json({ error: "Key and data are required" });
    }

    // Sanitize key (e.g., 'kimthi') -> 'kimthi.json'
    const safeKey = path.basename(key).replace(/[^a-z0-9_\-]/gi, '_');
    const filename = `${safeKey}.json`;

    // Check if OneDrive is ready (optional but good)
    if (!global.folderId || !global.driveId) {
        console.warn("⚠️ OneDrive not ready. Sync might fail if not initialized.");
    }

    try {
        let existingData = { data: {} };

        // 1. Try to load existing file first
        if (global.folderId && global.driveId) {
            try {
                console.log(`📥 Reading existing ${filename} for merge...`);
                const existingFile = await onedrive.getFileByName(filename, global.folderId, global.driveId);
                if (existingFile && existingFile.url) {
                    const resp = await fetch(existingFile.url);
                    if (resp.ok) {
                        const json = await resp.json();
                        if (json && json.data) {
                            existingData = json;
                            console.log(`✅ Loaded existing data with ${Object.keys(existingData.data).length} stories.`);
                        }
                    }
                } else {
                    console.log(`ℹ️ File ${filename} does not exist yet. Creating new.`);
                }
            } catch (readErr) {
                console.warn("⚠️ Failed to read existing file (ignoring):", readErr.message);
            }
        }

        // 2. MERGE DATA (Partial Update)
        // data from client is expected to be { "storyId": { ... } }
        console.log("🔄 Merging new data:", Object.keys(data));

        // Use deep merge or spread at story level
        // existingData.data = { ...existingData.data, ...data }; 
        // Iterate keys to ensure we don't wipe other props if any (?) 
        // Actually, client sends { "storyId": { ... } } so simple spread is fine for story-level keys.
        // But if we want to support deep merge within a story (unlikely needed for this simple case), we'd need lodash.merge.
        // For now, story-level replacement is desired behavior (update whole story progress).

        Object.assign(existingData.data, data);

        const content = JSON.stringify({
            data: existingData.data,
            last_updated: new Date().toISOString()
        }, null, 2);

        // 3. Save to Root of Shared Folder
        console.log(`📤 Saving merged ${filename} to OneDrive...`);
        const result = await onedrive.saveFile(
            filename,
            content,
            global.folderId,
            global.driveId
        );

        if (result.success) {
            console.log("✅ Save successful!");
            res.json({ success: true, message: "Saved to OneDrive successfully" });
        } else {
            throw new Error(result.error || "Unknown OneDrive error");
        }
    } catch (err) {
        console.error("Error saving progress to OneDrive:", err);
        res.status(500).json({ error: "Failed to save progress to Cloud" });
    }
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
        // Check if OneDrive is ready
        // if (!global.folderId || !global.driveId) {
        //     console.warn("⚠️ Using Root Drive for load (Shared folder not ready).");
        // }

        const folderId = global.folderId; // Undefined is fine (handled as root in helper?)
        const driveId = global.driveId;

        // Note: We need to ensure getFileByName handles missing IDs by checking root
        // OneDriveStorage.getFileByName implementation:
        // if (!this.client) return null;
        // listChildren(parentId, driveId) -> if !driveId, defaults to /me/drive/root/children
        // So it SHOULD work!

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
