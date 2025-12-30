
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import os from "os";

// -----------------------------------------------------------------------------
// [CONFIG] Internal Modules & Configuration
// -----------------------------------------------------------------------------
import onedrive from "./utils/OneDriveStorage.js";
import ttsLiveRoute from "./routes/ttsLive.js";
import syncRoute from "./routes/sync.js";
import onedriveRoute from "./routes/onedrive.js";
import offlineStoriesRoute from "./routes/offlineStories.js";
import users from "./data/users.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3002;
const app = express();
const swaggerDocument = YAML.load(path.join(process.cwd(), 'swagger.yaml'));

// Global State
let isOneDriveReady = false;

// -----------------------------------------------------------------------------
// [INIT] One Drive Initialization
// -----------------------------------------------------------------------------
onedrive.initialize().then(async success => {
    isOneDriveReady = success;
    if (success) {
        console.log("🚀 OneDrive Storage Ready!");
        const ids = await onedrive.getSharedFolderId();
        if (ids) {
            global.driveId = ids.driveId;
            global.folderId = ids.id;
            console.log(`📂 Resolved Shared Folder: ${ids.driveId} / ${ids.id}`);
        }
    }
});

// -----------------------------------------------------------------------------
// [MIDDLEWARE] Global Middlewares
// -----------------------------------------------------------------------------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "output"))); // Serve audio files
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// -----------------------------------------------------------------------------
// [ROUTES] View Routes (HTML Pages)
// -----------------------------------------------------------------------------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/listen/:storyId?/:chapterId?", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "listen.html"));
});

app.get("/audio/:storyId?/:chapterId?", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "audio_player.html"));
});

// -----------------------------------------------------------------------------
// [ROUTES] API Routes - Features
// -----------------------------------------------------------------------------
app.use("/api", ttsLiveRoute);
app.use("/api", syncRoute);
app.use("/api", onedriveRoute);
app.use("/api", offlineStoriesRoute);

// -----------------------------------------------------------------------------
// [ROUTES] API Routes - Auth & Data
// -----------------------------------------------------------------------------
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
    try {
        const filePath = path.join(__dirname, "data/data/dSachTruyen.js");
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf-8");
            const stories = JSON.parse(content);
            return res.json(stories.filter(story => !story.hidden));
        }
    } catch (e) {
        console.error("Local story load error:", e);
    }
    res.json([]);
});

// -----------------------------------------------------------------------------
// [ROUTES] API Routes - Complex / Custom Logic
// -----------------------------------------------------------------------------

// COVERS ROUTE (Served from local data/data/covers)
app.get("/covers/:id", (req, res) => {
    const { id } = req.params;
    const filePath = path.join(__dirname, "data", "data", "covers", id);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        // Try fallback if extension missing
        const filePathWithExt = path.join(__dirname, "data", "data", "covers", `${id}.jpg`);
        if (fs.existsSync(filePathWithExt)) {
            res.sendFile(filePathWithExt);
            return;
        }

        const notFoundPath = path.join(__dirname, "data", "data", "covers", "404.png");
        if (fs.existsSync(notFoundPath)) {
            res.status(404).sendFile(notFoundPath);
        } else {
            res.status(404).send("Cover not found");
        }
    }
});

// STORY CONTENT ROUTE (Dynamic with Graph API)
app.get("/api/story-content/:id", async (req, res) => {
    const { id } = req.params;
    const safeId = path.basename(id);

    // 1. Try OneDrive
    if (isOneDriveReady && global.driveId && global.folderId) {
        try {
            const rootChildren = await onedrive.listChildren(global.folderId, global.driveId);
            const dataFolder = rootChildren.find(c => c.name === 'data');

            if (dataFolder) {
                const dataChildren = await onedrive.listChildren(dataFolder.id, global.driveId);
                const truyenFolder = dataChildren.find(c => c.name === 'truyen');

                if (truyenFolder) {
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

    // 2. Fallback to Local
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

// TEST SAVE ROUTE
app.post("/api/test-save", async (req, res) => {
    const { filename, content } = req.body;
    if (!isOneDriveReady) return res.status(503).json({ error: "OneDrive not ready" });

    try {
        const result = await onedrive.saveFile(filename || "kimthi.json", content || JSON.stringify({ updated: Date.now() }), global.folderId, global.driveId);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// -----------------------------------------------------------------------------
// [START] Server
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
    const interfaces = os.networkInterfaces();
    let lanIp = interfaces["Wi-Fi"]?.find((item) => item?.family === 'IPv4' && !item.internal)?.address;
    console.log(`\n🚀 Server đang chạy!`);
    console.log(`👉 Local:   http://localhost:${PORT}`);
    if (lanIp) console.log(`👉 Network: http://${lanIp}:${PORT}\n`);
});
