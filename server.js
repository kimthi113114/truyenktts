import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

// import dSachTruyen from "./data/dSachTruyen.js"; // DEPRECATED: Now using OneDrive
import onedrive from "./utils/OneDriveStorage.js"; // Import the class

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

let storiesCache = [];
let isOneDriveReady = false;

// --- OneDrive Initialization & Config Loading ---
onedrive.initialize().then(async success => {
    isOneDriveReady = success;
    if (success) {
        console.log("🚀 OneDrive Storage Ready!");

        // Resolve Shared Folder
        const ids = await onedrive.getSharedFolderId();
        if (ids) {
            global.driveId = ids.driveId;
            global.folderId = ids.id;
            console.log(`📂 Resolved Shared Folder: ${ids.driveId} / ${ids.id}`);
        }
    }
});
// ----------------------------


app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// COVERS ROUTE (Dynamic with Graph API)
app.get("/covers/:id", async (req, res) => {
    const { id } = req.params;

    // 1. Try OneDrive
    if (isOneDriveReady && global.driveId && global.folderId) {
        // We look for {id}.jpg inside the "covers" folder (which is a child of shared folder)
        // Check if we need to find "covers" folder first?
        // The shared link IS the parent. It contains "covers" and "data".
        // So global.folderId is the ROOT.
        // We need to list children of ROOT, find "covers", then find file.
        // For performance, we should cache these folder IDs. But for now, we traverse.

        // This traversal logic is heavy for every request. Ideally implemented in OneDriveStorage with caching.
        // For MVP, let's ask OneDriveStorage to find it.
        // We assume file name contains ID.

        try {
            // Finding 'covers' folder first
            const rootChildren = await onedrive.listChildren(global.folderId, global.driveId);
            const coversFolder = rootChildren.find(c => c.name === 'covers');

            if (coversFolder) {
                // Now find the image in covers
                const file = await onedrive.getFileByName(`${id}`, coversFolder.id, global.driveId)
                    || await onedrive.getFileByName(`${id}.jpg`, coversFolder.id, global.driveId);

                if (file && file.url) {
                    return res.redirect(file.url);
                }
            }
        } catch (e) {
            console.error("Cover fetch error:", e.message);
        }
    }

    // 2. Fallback to Local
    const filePath = path.join(__dirname, "covers", `${id}`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).sendFile(path.join(__dirname, "covers", "404.png"));
    }
});

app.get("/listen/:storyId?/:chapterId?", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "listen.html"));
});

app.get("/audio/:storyId?/:chapterId?", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "audio_player.html"));
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "output"))); // Serve audio files

import ttsLiveRoute from "./routes/ttsLive.js";
import syncRoute from "./routes/sync.js";

app.use("/api", ttsLiveRoute);
app.use("/api", syncRoute);


// --- NEW ROUTE: TEST SAVE ---
// POST /api/test-save { filename: "kimthi.json", content: "..." }
app.post("/api/test-save", async (req, res) => {
    const { filename, content } = req.body;
    if (!isOneDriveReady) return res.status(503).json({ error: "OneDrive not ready" });

    try {
        // Save to Root of Shared Folder
        const result = await onedrive.saveFile(filename || "kimthi.json", content || JSON.stringify({ updated: Date.now() }), global.folderId, global.driveId);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// ----------------------------

import users from "./data/users.js";

app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true, user: { username: user.username } });
    } else {
        res.status(401).json({ success: false, message: "Invalid credentials" });
    }
});

app.get("/api/stories-listen", async (req, res) => {
    // FETCH CACHED CLOUD STORIES ON DEMAND
    if (isOneDriveReady && global.driveId && global.folderId) {
        try {
            const file = await onedrive.getFileByName("stories.json", global.folderId, global.driveId);
            if (file && file.url) {
                const response = await fetch(file.url);
                if (response.ok) {
                    const stories = await response.json();
                    return res.json(stories.filter(story => !story.hidden));
                }
            }
        } catch (err) {
            console.error("❌ Failed to fetch stories.json:", err);
        }
    }

    // Fallback or empty
    res.json([]);
});

// STORY CONTENT ROUTE (Dynamic with Graph API)
app.get("/api/story-content/:id", async (req, res) => {
    const { id } = req.params;
    const safeId = path.basename(id);

    // 1. Try OneDrive
    if (isOneDriveReady && global.driveId && global.folderId) {
        try {
            // Navigate: Root -> data -> truyen -> file
            const rootChildren = await onedrive.listChildren(global.folderId, global.driveId);
            const dataFolder = rootChildren.find(c => c.name === 'data');

            if (dataFolder) {
                const dataChildren = await onedrive.listChildren(dataFolder.id, global.driveId);
                const truyenFolder = dataChildren.find(c => c.name === 'truyen');

                if (truyenFolder) {
                    // Try exact match or partial
                    const file = await onedrive.getFileByName(`${safeId}.txt`, truyenFolder.id, global.driveId);

                    if (file && file.url) {
                        const response = await fetch(file.url);
                        if (response.ok) {
                            const content = await response.text();
                            return res.json({ content });
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Story fetch error:", e.message);
        }
    }

    // 2. Fallback to Local (if file restored locally)
    const filePath = path.join(__dirname, "data", "truyen", `${safeId}.txt`);
    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, "utf-8");
            res.json({ content });
        } catch (err) {
            console.error("Error reading story file:", err);
            res.status(500).json({ error: "Failed to read story file" });
        }
    } else {
        res.status(404).json({ error: "Story file not found (checked Cloud & Local)" });
    }
});

import os from "os";

app.listen(PORT, () => {
    const interfaces = os.networkInterfaces();
    let lanIp = interfaces["Wi-Fi"]?.find((item) => item?.family === 'IPv4' && !item.internal)?.address;
    console.log(`\n🚀 Server đang chạy!`);
    console.log(`👉 Local:   http://localhost:${PORT}`);
    console.log(`👉 Network: http://${lanIp}:${PORT}\n`);
});
