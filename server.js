import express from "express";
import path from "path";
import fs from "fs"; // Import fs
import { fileURLToPath } from "url";
import { configureFfmpeg } from "./utils/ffmpegConfig.js";
import dSachTruyen from "./data/dSachTruyen.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

configureFfmpeg(); // setup ffmpeg/ffprobe paths

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "output"))); // Serve audio files

import extractRoute from "./routes/extract.js";
import exportEpubRoute from "./routes/exportEpub.js";
import exportEpubUnTocRoute from "./routes/exportEpubUnToc.js";
import ttsRoute from "./routes/tts.js";
import ttsLiveRoute from "./routes/ttsLive.js";
import videoExportRoute from "./routes/videoExport.js";
import geminiRoute from "./routes/gemini.js";

import copilotRoute from "./routes/copilot.js";
import chatgptRoute from "./routes/chatgpt.js";

app.use("/", extractRoute);
app.use("/", exportEpubRoute);
app.use("/", exportEpubUnTocRoute);
app.use("/api", ttsRoute);
app.use("/api", ttsLiveRoute);
app.use("/api", videoExportRoute);
app.use("/api", geminiRoute);
app.use("/api", copilotRoute);
app.use("/api", chatgptRoute);

app.get("/api/stories", (req, res) => {
    res.json(dSachTruyen);
});

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
