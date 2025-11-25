import express from "express";
import { EdgeTTS } from "node-edge-tts";
import fs from "fs";
import path from "path";
import os from "os";

const router = express.Router();

/**
 * POST /api/tts-live
 * Generate TTS audio without saving to disk
 * Returns base64 encoded audio data
 */
router.post("/tts-live", async (req, res) => {
    try {
        const { text, voice = "vi-VN-NamMinhNeural", speed = 1.0 } = req.body;

        if (!text) {
            return res.status(400).json({ error: "Text is required" });
        }

        // Sanitize text
        const sanitizedText = text.replace(/["'`«»""'']/g, '').replace(/:/g, ',').replace(/\s+/g, ' ').trim();
        const speedPercent = Math.round((speed - 1) * 100);
        const rateStr = speedPercent >= 0 ? `+${speedPercent}%` : `${speedPercent}%`;

        // Use Edge TTS
        const tempFile = path.join(os.tmpdir(), `tts_live_${Date.now()}.mp3`);

        try {
            // Generate audio with node-edge-tts with retry logic
            let retries = 10;
            let lastError;

            while (retries > 0) {
                try {
                    const tts = new EdgeTTS({ voice, rate: rateStr, volume: "+0%" });
                    await tts.ttsPromise(sanitizedText, tempFile);
                    break; // Success
                } catch (err) {
                    lastError = err;
                    retries--;
                    console.warn(`TTS generation failed, retrying... (${retries} left)`, err, req.body);
                    if (retries > 0) await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
                }
            }

            if (retries === 0 && lastError) throw lastError;

            // Wait a bit for file to be written
            await new Promise(r => setTimeout(r, 100));

            // Read file and convert to base64
            const audioBuffer = fs.readFileSync(tempFile);
            const base64Audio = audioBuffer.toString('base64');

            // Clean up temp file
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {
                // Ignore cleanup errors
            }
            res.json({
                success: true,
                audio: base64Audio,
                mimeType: 'audio/mpeg'
            });
        } catch (err) {
            // Clean up on error
            try {
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) { }
            throw err;
        }
    } catch (err) {
        console.error("TTS Live error:", err);
        res.status(500).json({
            error: "Failed to generate TTS",
            details: err.message
        });
    }
});


export default router;
