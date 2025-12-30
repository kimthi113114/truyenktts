import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import onedrive from "../utils/OneDriveStorage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// [MODIFIED] Use SSE (Server-Sent Events) for real-time progress
router.get("/onedrive/init-download", async (req, res) => {
    // SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        sendEvent({ type: 'log', message: '🚀 Initializing OneDrive Sync...' });

        // 1. Ensure OneDrive is ready
        if (!onedrive.client) {
            sendEvent({ type: 'log', message: '🔄 Authenticating with OneDrive...' });
            const success = await onedrive.initialize();
            if (!success) {
                sendEvent({ type: 'error', message: "OneDrive initialization failed. Check credentials." });
                return res.end();
            }
        }

        // 2. Resolve Shared Folder IDs if not globalized
        if (!global.driveId || !global.folderId) {
            sendEvent({ type: 'log', message: '🔍 Resolving shared folder...' });
            const ids = await onedrive.getSharedFolderId();
            if (ids) {
                global.driveId = ids.driveId;
                global.folderId = ids.id;
            } else {
                sendEvent({ type: 'error', message: "Could not resolve shared folder ID." });
                return res.end();
            }
        }

        const dataPath = path.join(__dirname, "../data");
        sendEvent({ type: 'log', message: `📂 Starting download to local data folder...` });

        // 3. Trigger Download with Progress Callback
        await onedrive.downloadFolder(global.folderId, global.driveId, dataPath, (progress) => {
            sendEvent(progress);
        });

        sendEvent({ type: 'done', message: "✅ Full download completed successfully." });
        res.end();
    } catch (error) {
        console.error("❌ OneDrive Download API dynamic error:", error);
        sendEvent({ type: 'error', message: error.message });
        res.end();
    }
});

// Keep the POST for legacy or non-streaming if needed, but GET is standard for EventSource.
// However, since we are fetching via JS, we can use GET for EventSource.
// If we want to keep POST structure, we'd need to use fetch with body reader.
// Let's stick to GET for standard EventSource usage as planned.

export default router;
