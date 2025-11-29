import express from "express";
import { EdgeTTS } from "node-edge-tts";
import fs from "fs";
import path from "path";
import os from "os";

const router = express.Router();

function splitText(text, maxLength = 2000) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let currentChunk = "";
    const sentences = text.split(/([.?!:\n]+)/);

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        if ((currentChunk + sentence).length > maxLength) {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = sentence;
        } else {
            currentChunk += sentence;
        }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
}

/**
 * POST /api/tts-live
 * Generate TTS audio without saving to disk (concatenates chunks for long text)
 * Returns base64 encoded audio data
 */
router.post("/tts-live", async (req, res) => {
    try {
        const { text, voice = "vi-VN-NamMinhNeural", speed = 1.0 } = req.body;

        if (!text) {
            return res.status(400).json({ error: "Text is required" });
        }

        // 1. Sanitize & Config
        const sanitizedText = text.replace(/["'`«»""'']/g, '').replace(/:/g, ',').replace(/\s+/g, ' ').trim();
        const speedPercent = Math.round((speed - 1) * 100);
        const rateStr = speedPercent >= 0 ? `+${speedPercent}%` : `${speedPercent}%`;

        // 2. Split text
        const chunks = splitText(sanitizedText, 200);

        // Hàm xử lý từng chunk (Chạy độc lập)
        const processChunk = async (chunk, index) => {
            if (!chunk.trim()) return null;

            const tempFile = path.join(os.tmpdir(), `tts_live_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.mp3`);
            let retries = 10;
            let lastError;

            // Logic Retry
            while (retries > 0) {
                try {
                    const tts = new EdgeTTS({ voice, rate: rateStr, volume: "+0%" });
                    await tts.ttsPromise(chunk, tempFile);

                    // Đợi file được ghi xong hẳn (file system latency)
                    await new Promise(r => setTimeout(r, 100));

                    // Đọc file ra buffer
                    const buffer = await fs.promises.readFile(tempFile);

                    // Xóa file tạm ngay lập tức sau khi đọc xong để dọn rác
                    await fs.promises.unlink(tempFile).catch(() => { });

                    return buffer;
                } catch (err) {
                    lastError = err;
                    retries--;
                    console.warn(`Chunk ${index} failed, retrying... (${retries} left)`, err.message);
                    if (retries > 0) await new Promise(r => setTimeout(r, 1000));
                }
            }

            // Nếu hết retry mà vẫn lỗi, thử xóa file rác nếu còn tồn tại
            if (fs.existsSync(tempFile)) await fs.promises.unlink(tempFile).catch(() => { });
            throw lastError || new Error(`Failed to generate chunk ${index}`);
        };

        // 3. Chạy song song tất cả các chunk (Concurrency)
        // Promise.all vẫn giữ đúng thứ tự mảng trả về so với mảng input
        const buffers = await Promise.all(chunks.map((chunk, i) => processChunk(chunk, i)));

        // 4. Lọc bỏ các chunk null (nếu có) và nối lại
        const validBuffers = buffers.filter(b => b !== null);
        const finalBuffer = Buffer.concat(validBuffers);
        const base64Audio = finalBuffer.toString('base64');

        res.json({
            success: true,
            audio: base64Audio,
            mimeType: 'audio/mpeg'
        });

    } catch (err) {
        console.error("TTS Live error:", err);
        res.status(500).json({
            error: "Failed to generate TTS",
            details: err.message
        });
    }
});

router.post("/tts-live-stream", async (req, res) => {
    try {
        const { text, voice = "vi-VN-NamMinhNeural", speed = 1.0 } = req.body;

        if (!text) return res.status(400).json({ error: "Text is required" });

        // Cấu hình Header để Stream dữ liệu
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        // 1. Sanitize & Config
        const sanitizedText = text.replace(/["'`«»""'']/g, '').replace(/:/g, ',').replace(/\s+/g, ' ').trim();
        const speedPercent = Math.round((speed - 1) * 100);
        const rateStr = speedPercent >= 0 ? `+${speedPercent}%` : `${speedPercent}%`;

        // 2. Split text
        const chunks = splitText(sanitizedText, 200);
        const totalChunks = chunks.length;
        let completedChunks = 0; // Biến đếm tiến độ

        // Hàm xử lý từng chunk
        const processChunk = async (chunk, index) => {
            if (!chunk.trim()) return null;

            const tempFile = path.join(os.tmpdir(), `tts_live_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.mp3`);
            let retries = 10;
            let lastError;

            while (retries > 0) {
                try {
                    const tts = new EdgeTTS({ voice, rate: rateStr, volume: "+0%" });
                    await tts.ttsPromise(chunk, tempFile);
                    await new Promise(r => setTimeout(r, 100));
                    const buffer = await fs.promises.readFile(tempFile);
                    await fs.promises.unlink(tempFile).catch(() => { });

                    // --- CẬP NHẬT TIẾN ĐỘ ---
                    completedChunks++;
                    const percent = Math.round((completedChunks / totalChunks) * 100);

                    // Gửi dòng JSON về client: {"type": "progress", "val": 50}
                    res.write(JSON.stringify({ type: 'progress', val: percent }) + '\n');

                    return buffer;
                } catch (err) {
                    lastError = err;
                    retries--;
                    if (retries > 0) await new Promise(r => setTimeout(r, 1000));
                }
            }
            if (fs.existsSync(tempFile)) await fs.promises.unlink(tempFile).catch(() => { });
            throw lastError || new Error(`Failed to generate chunk ${index}`);
        };

        // 3. Chạy song song
        const buffers = await Promise.all(chunks.map((chunk, i) => processChunk(chunk, i)));

        // 4. Kết thúc: Gửi dữ liệu Audio cuối cùng
        const validBuffers = buffers.filter(b => b !== null);
        const finalBuffer = Buffer.concat(validBuffers);
        const base64Audio = finalBuffer.toString('base64');

        // Gửi dòng JSON cuối cùng: {"type": "done", "audio": "..."}
        res.write(JSON.stringify({
            type: 'done',
            audio: base64Audio,
            mimeType: 'audio/mpeg'
        }) + '\n');

        res.end(); // Đóng kết nối

    } catch (err) {
        console.error("TTS Live error:", err);
        // Nếu lỗi xảy ra giữa chừng, gửi event lỗi
        if (!res.headersSent) res.status(500).json({ error: err.message });
        else res.end(JSON.stringify({ type: 'error', msg: err.message }));
    }
});


export default router;
