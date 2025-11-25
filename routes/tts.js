import express from "express";
import fs from "fs";
import path from "path";
import {
    splitText,
    callGoogleTTS,
    callEdgeTTS,
    mergeAudio,
    parallelLimit,
    createProgress,
    updateProgress,
    finishProgress,
    failProgress,
    getProgress, // Import getProgress
} from "../utils/audioUtils.js";
import ffmpeg from "fluent-ffmpeg";
import crypto from "crypto"; // dùng thay cho uuid

const router = express.Router();
const MAX_CONCURRENCY = 4;

router.post("/tts", async (req, res) => {
    const { text, speed = 1.0, name = "tts-", provider = "google", voice } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Thiếu nội dung text" });

    const safeSpeed = Math.min(Math.max(Number(speed), 0.5), 2.0); // ép kiểu, giới hạn
    const parts = splitText(text);
    const jobId = crypto.randomUUID();
    createProgress(jobId, parts.length);

    console.log(`🎙️ Bắt đầu TTS job ${jobId} — ${parts.length} đoạn (speed=${safeSpeed}x)`);

    res.json({ jobId, speed: safeSpeed, message: "Đang xử lý, theo dõi console để xem tiến độ" });

    try {
        const partFiles = [];
        let done = 0;

        const tasks = parts.map((segment, i) => async () => {
            let buf;
            if (provider === "edge") {
                buf = await callEdgeTTS(segment, voice, safeSpeed);
            } else {
                buf = await callGoogleTTS(segment);
            }

            const rawFile = path.join("./tmp", `part-${jobId}-${i}-raw.mp3`);
            const file = path.join("./tmp", `part-${jobId}-${i}.mp3`);
            fs.writeFileSync(rawFile, buf);

            if (provider === "edge") {
                // Edge TTS đã chỉnh speed rồi, không cần ffmpeg atempo
                fs.renameSync(rawFile, file);
            } else {
                // Google TTS cần ffmpeg để chỉnh tốc độ
                await new Promise((resolve, reject) => {
                    ffmpeg(rawFile)
                        .audioFilter(`atempo=${safeSpeed}`)
                        .on("error", reject)
                        .on("end", () => {
                            fs.unlinkSync(rawFile); // xóa file gốc
                            resolve();
                        })
                        .save(file);
                });
            }

            partFiles.push(file);
            done++;
            updateProgress(jobId, done);
        });

        const results = await parallelLimit(tasks, MAX_CONCURRENCY);

        // Check for errors
        const errors = results.filter(r => r && r.error);
        if (errors.length > 0) {
            console.error(`❌ ${errors.length} tasks failed:`, errors[0].error);
            // If all failed, throw
            if (errors.length === parts.length) {
                throw new Error(`All TTS tasks failed. First error: ${errors[0].error.message}`);
            }
        }

        // ✅ Sau khi ghi xong tất cả part files
        const filename = `${name}_${Date.now()}_x${safeSpeed}.mp3`;
        console.log(name);

        console.log(filename);

        const outputPath = path.join("./output", filename);

        // Sort lại part files theo chỉ số
        const orderedFiles = fs.readdirSync("./tmp")
            .filter(f => f.startsWith(`part-${jobId}-`))
            .sort((a, b) => {
                const ai = parseInt(a.match(/-(\d+)\.mp3$/)[1]);
                const bi = parseInt(b.match(/-(\d+)\.mp3$/)[1]);
                return ai - bi;
            })
            .map(f => path.join("./tmp", f));

        await mergeAudio(orderedFiles, outputPath);

        // Xoá file tạm sau khi ghép
        orderedFiles.forEach(f => fs.unlinkSync(f));

        finishProgress(jobId, outputPath);

    } catch (err) {
        failProgress(jobId, err.message);
    }
});

router.get("/tts/status/:jobId", (req, res) => {
    const { jobId } = req.params;
    const progress = getProgress(jobId);

    if (!progress) {
        return res.status(404).json({ error: "Job not found" });
    }

    if (progress.status === "finished") {
        return res.json({
            status: "done",
            filename: path.basename(progress.file), // Return just the filename
        });
    } else if (progress.status === "error") {
        return res.json({
            status: "failed",
            error: progress.error,
        });
    } else {
        const percent = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
        // Use stored percent if available (for video phase)
        const finalPercent = progress.percent || percent;
        return res.json({
            status: "running",
            progress: finalPercent,
            phase: progress.phase || "tts"
        });
    }
});

export default router;
