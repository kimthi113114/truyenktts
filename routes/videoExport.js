import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
    updatePercent, // Import updatePercent
} from "../utils/audioUtils.js";
import { createVideoFromAudioMultiChapter } from "../utils/videoUtils.js";
import ffmpeg from "fluent-ffmpeg";

const router = express.Router();
const MAX_CONCURRENCY = 4;

router.post("/video-export", async (req, res) => {
    const {
        chapters,  // Array of {number, title, content}
        speed = 1.0,
        name = "video-",
        provider = "google",
        voice,
        theme = "toi",
        coverPath  // Path to cover image (relative to public folder)
    } = req.body;

    if (!chapters || chapters.length === 0) {
        return res.status(400).json({ error: "Thiếu danh sách chương" });
    }

    const safeSpeed = Math.min(Math.max(Number(speed), 0.5), 2.0);
    const jobId = crypto.randomUUID();

    console.log(`🎬 Bắt đầu Video Export job ${jobId} — ${chapters.length} chương (speed=${safeSpeed}x)`);

    res.json({ jobId, speed: safeSpeed, message: "Đang xử lý video, theo dõi console để xem tiến độ" });

    try {
        // Step 1: Prepare full text from all chapters
        const fullText = chapters.map(ch =>
            `Chương ${ch.number} ${ch.title}. ${ch.content}`
        ).join(" ");

        const parts = splitText(fullText);
        createProgress(jobId, parts.length);

        const partFiles = [];
        let done = 0;

        // Step 2: Generate audio parts
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
                fs.renameSync(rawFile, file);
            } else {
                await new Promise((resolve, reject) => {
                    ffmpeg(rawFile)
                        .audioFilter(`atempo=${safeSpeed}`)
                        .on("error", reject)
                        .on("end", () => {
                            fs.unlinkSync(rawFile);
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

        // Check for errors and log failed segments
        const errors = results.filter((r, idx) => {
            if (r && r.error) {
                console.error(`\n❌ Task ${idx} failed:`);
                console.error(`   Text: "${parts[idx].substring(0, 100)}..."`);
                console.error(`   Error: ${r.error.message || r.error}`);
                console.error(`   Full text length: ${parts[idx].length} chars\n`);
                return true;
            }
            return false;
        });

        if (errors.length > 0) {
            console.error(`\n⚠️ Total ${errors.length}/${parts.length} tasks failed`);
            if (errors.length === parts.length) {
                throw new Error(`All TTS tasks failed. First error: ${errors[0].error.message}`);
            }
        }

        // Step 3: Merge audio files
        const audioFilename = `${name}_${Date.now()}_audio.mp3`;
        const audioPath = path.join("./tmp", audioFilename);

        const orderedFiles = fs.readdirSync("./tmp")
            .filter(f => f.startsWith(`part-${jobId}-`))
            .sort((a, b) => {
                const ai = parseInt(a.match(/-(\d+)\.mp3$/)[1]);
                const bi = parseInt(b.match(/-(\d+)\.mp3$/)[1]);
                return ai - bi;
            })
            .map(f => path.join("./tmp", f));

        await mergeAudio(orderedFiles, audioPath);

        // Clean up part files
        orderedFiles.forEach(f => fs.unlinkSync(f));

        console.log("🎵 Audio merged successfully");

        // Step 4: Create video from audio with chapter list and cover
        const videoFilename = `${name}_${Date.now()}_x${safeSpeed}.mp4`;
        const videoPath = path.join("./output", videoFilename);

        // Prepare chapter info for display
        const chapterInfo = chapters.map(ch => ({
            number: ch.number,
            title: ch.title
        }));

        // Resolve cover path - use ./covers folder
        const fullCoverPath = coverPath
            ? path.join("./covers", path.basename(coverPath))
            : path.join("./covers", "default-cover.jpg");

        console.log(`🎬 Creating multi-chapter video with theme: ${theme}`);

        // Extract story info from first chapter or use defaults
        const storyTitle = chapters[0]?.title?.split(':')[0] || "Story Title";
        const author = "Author Name";  // TODO: get from request body
        const website = "truyendocviet.com";

        await createVideoFromAudioMultiChapter(
            audioPath,
            chapterInfo,
            fullCoverPath,
            videoPath,
            theme,
            storyTitle,
            author,
            website,
            (percent) => updatePercent(jobId, percent, "video") // Pass callback
        );

        // Clean up audio file
        fs.unlinkSync(audioPath);

        finishProgress(jobId, videoPath);

    } catch (err) {
        failProgress(jobId, err.message);
    }
});

export default router;
