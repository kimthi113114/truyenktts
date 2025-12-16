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
        const content = JSON.stringify({
            data: data,
            last_updated: new Date().toISOString()
        }, null, 2);

        // Save to Root of Shared Folder (or a subfolder if we implemented that)
        const result = await onedrive.saveFile(
            filename,
            content,
            global.folderId,
            global.driveId
        );

        if (result.success) {
            res.json({ success: true, message: "Saved to OneDrive successfully" });
        } else {
            // Fallback? Or just error. User demanded Cloud interaction.
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
        if (!global.folderId || !global.driveId) {
            console.warn("⚠️ OneDrive not ready for load.");
            return res.status(503).json({ error: "Cloud storage not ready" });
        }

        const file = await onedrive.getFileByName(filename, global.folderId, global.driveId);

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
