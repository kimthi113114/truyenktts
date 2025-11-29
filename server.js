import express from "express";
import path from "path";
import fs from "fs"; // Import fs
import { fileURLToPath } from "url";

import dSachTruyen from "./data/dSachTruyen.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;



app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "listen.html"));
});
app.get("/audio", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "audio_player.html"));
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "output"))); // Serve audio files

import ttsLiveRoute from "./routes/ttsLive.js";
import syncRoute from "./routes/sync.js";

app.use("/api", ttsLiveRoute);
app.use("/api", syncRoute);



app.get("/api/stories-listen", (req, res) => {
    res.json(dSachTruyen.filter(story => !story.hidden));
});

app.get("/api/story-content/:id", (req, res) => {
    const { id } = req.params;
    // Prevent directory traversal
    const safeId = path.basename(id);
    const filePath = path.join(__dirname, "data", "truyen", `${safeId}.txt`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Story file not found" });
    }

    try {
        const content = fs.readFileSync(filePath, "utf-8");
        res.json({ content });
    } catch (err) {
        console.error("Error reading story file:", err);
        res.status(500).json({ error: "Failed to read story file" });
    }
});

import os from "os";

app.listen(PORT, () => {
    const interfaces = os.networkInterfaces();
    let lanIp = 'localhost';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                lanIp = iface.address;
                break;
            }
        }
        if (lanIp !== 'localhost') break;
    }

    console.log(`\n🚀 Server đang chạy!`);
    console.log(`👉 Local:   http://localhost:${PORT}`);
    console.log(`👉 Network: http://${lanIp}:${PORT}\n`);
});
