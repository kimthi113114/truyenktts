import express from "express";
import { EdgeTTS } from "node-edge-tts";
import fs from "fs";
import path from "path";
import os from "os";
import getMp3Duration from "get-mp3-duration";

const router = express.Router();

// -----------------------------------------------------------------------------
// [UTILS] Text Processing Helpers
// -----------------------------------------------------------------------------

/**
 * Split long text by sentences to stay within length limits
 */
function splitTextBySentences(text, maxLength = 2000) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let currentChunk = "";
    const sentences = text.split(/([.?!:\n]+)/);

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        if ((currentChunk + sentence).length > maxLength) {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += sentence;
        }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
}

/**
 * Advanced text splitting for optimal TTS quality
 */
function splitText(text, maxLength = 150, minLineLength = 10) {
    // 1. Split by newlines
    let lines = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    // 2. Merge short lines with next ones
    const merged = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length <= minLineLength && i + 1 < lines.length) {
            lines[i + 1] = line + " " + lines[i + 1];
        } else {
            merged.push(line);
        }
    }

    // 3. Ensure chunks stay within maxLength
    const chunks = [];
    for (const line of merged) {
        if (line.length <= maxLength) {
            chunks.push(line);
        } else {
            const pieces = splitTextBySentences(line, maxLength);
            chunks.push(...pieces);
        }
    }

    return chunks;
}

// -----------------------------------------------------------------------------
// [CORE] TTS Generation Logic
// -----------------------------------------------------------------------------

/**
 * Process a single text chunk into an MP3 buffer
 */
async function processTtsChunk(chunk, index, config) {
    const { voice, rate, onProgress } = config;
    if (!chunk.trim()) return null;

    const tempFile = path.join(os.tmpdir(), `tts_live_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.mp3`);
    let retries = 5;
    let lastError;

    while (retries > 0) {
        try {
            const tts = new EdgeTTS({ voice, rate, volume: "+0%" });
            await tts.ttsPromise(chunk, tempFile);

            // Wait briefly for file system to sync
            await new Promise(r => setTimeout(r, 50));

            // Read buffer and clean up
            const buffer = await fs.promises.readFile(tempFile);
            await fs.promises.unlink(tempFile).catch(() => { });

            if (onProgress) onProgress();

            return buffer;
        } catch (err) {
            lastError = err;
            retries--;
            if (retries > 0) await new Promise(r => setTimeout(r, 500));
        }
    }

    if (fs.existsSync(tempFile)) await fs.promises.unlink(tempFile).catch(() => { });
    throw lastError || new Error(`Failed to generate chunk ${index}`);
}

// -----------------------------------------------------------------------------
// [API] Endpoints
// -----------------------------------------------------------------------------

/**
 * POST /api/tts-live
 * Traditional one-shot TTS response
 */
router.post("/tts-live", async (req, res) => {
    try {
        const { text, voice = "vi-VN-NamMinhNeural", speed = 1.0 } = req.body;
        if (!text) return res.status(400).json({ error: "Text is required" });

        // Original simple sanitization as requested
        const sanitizedText = text.replace(/["'`«»""'']/g, '').replace(/:/g, ',').replace(/\s+/g, ' ').trim();

        const speedPercent = Math.round((speed - 1) * 100);
        const rate = speedPercent >= 0 ? `+${speedPercent}%` : `${speedPercent}%`;

        // Split and process parallelly
        const chunks = splitText(sanitizedText, 200, 10);
        const buffers = await Promise.all(
            chunks.map((chunk, i) => processTtsChunk(chunk, i, { voice, rate }))
        );

        const finalBuffer = Buffer.concat(buffers.filter(Boolean));
        res.json({
            success: true,
            audio: finalBuffer.toString('base64'),
            mimeType: 'audio/mpeg'
        });

    } catch (err) {
        console.error("TTS Live Error:", err);
        res.status(500).json({ error: "Failed to generate TTS", details: err.message });
    }
});

/**
 * POST /api/tts-live-stream
 * Streaming mode with progress reporting and subtitles
 */
router.post("/tts-live-stream", async (req, res) => {
    try {
        const { text, voice = "vi-VN-NamMinhNeural", speed = 1.0 } = req.body;
        if (!text) return res.status(400).json({ error: "Text is required" });

        // Enable streaming headers
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const sanitizedText = text.trim();
        const speedPercent = Math.round((speed - 1) * 100);
        const rate = speedPercent >= 0 ? `+${speedPercent}%` : `${speedPercent}%`;

        const chunks = splitText(sanitizedText, 150, 10);
        const totalChunks = chunks.length;
        let completedChunks = 0;

        // Progress callback to stream updates to client
        const onProgress = () => {
            completedChunks++;
            const percent = Math.round((completedChunks / totalChunks) * 100);
            res.write(JSON.stringify({ type: 'progress', val: percent }) + '\n');
        };

        // Process all chunks parallelly with internal complex logic for each chunk as request
        const buffers = await Promise.all(
            chunks.map((chunk, i) => {
                // Restore original complex cleaning logic for stream chunks
                const cleanedChunk = chunk
                    .replace(/[x×]\s*(\d+)/g, ' với số lượng $1 ')
                    .replace(/[【】\[\]\(\)”“"]/g, '.')
                    .replaceAll("+", " cộng ")
                    .replaceAll("-", " trừ ")
                    .trim();

                return processTtsChunk(cleanedChunk, i, { voice, rate, onProgress });
            })
        );

        // Generate final buffer and subtitles mapping
        const validBuffers = [];
        const subtitles = [];
        let currentTimestamp = 0;

        buffers.forEach((buffer, index) => {
            if (buffer) {
                validBuffers.push(buffer);
                const durationMs = getMp3Duration(buffer);
                subtitles.push({
                    text: chunks[index],
                    start: currentTimestamp / 1000,
                    end: (currentTimestamp + durationMs) / 1000
                });
                currentTimestamp += durationMs;
            }
        });

        // Send final chunk with audio data
        const finalBuffer = Buffer.concat(validBuffers);
        res.write(JSON.stringify({
            type: 'done',
            audio: finalBuffer.toString('base64'),
            mimeType: 'audio/mpeg',
            subtitles: subtitles
        }) + '\n');

        res.end();

    } catch (err) {
        console.error("TTS Live Stream Error:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        } else {
            res.write(JSON.stringify({ type: 'error', msg: err.message }) + '\n');
            res.end();
        }
    }
});

export default router;
