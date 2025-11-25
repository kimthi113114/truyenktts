import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import fetch from "node-fetch";
import { EdgeTTS } from "node-edge-tts";

const MAX_CHARS = 190;
const TMP_DIR = "./tmp";
const OUT_DIR = "./output";
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

export function splitText(input, maxLen = MAX_CHARS) {
    const cleaned = input.replace(/\s+/g, " ").trim();
    if (cleaned.length <= maxLen) return [cleaned];
    const parts = [];
    let current = "";
    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
        if (sentence.length > maxLen) {
            if (current) {
                parts.push(current.trim());
                current = "";
            }
            const words = sentence.split(/(?<=,)\s+|\s+/);
            for (const word of words) {
                if ((current + " " + word).length > maxLen && current) {
                    parts.push(current.trim());
                    current = word;
                } else {
                    current = current ? current + " " + word : word;
                }
            }
        } else if ((current + " " + sentence).length > maxLen) {
            if (current) parts.push(current.trim());
            current = sentence;
        } else {
            current = current ? current + " " + sentence : sentence;
        }
    }
    if (current) parts.push(current.trim());
    return parts.filter((x) => x.length);
}

export async function callGoogleTTS(text, speed = 1.0) {
    const safeSpeed = Math.min(Math.max(speed, 0.5), 2.0);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob&ttsspeed=${safeSpeed}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "audio/mpeg",
        },
    });
    if (!res.ok) throw new Error(`TTS error: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

export async function callEdgeTTS(text, voice = "vi-VN-NamMinhNeural", speed = 1.0) {
    const sanitizedText = text.replace(/["'`«»""'']/g, '').replace(/:/g, ',').replace(/\s+/g, ' ').trim();
    const speedPercent = Math.round((speed - 1) * 100);
    const rateStr = speedPercent >= 0 ? `+${speedPercent}%` : `${speedPercent}%`;

    const maxRetries = 5;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const tmpFile = path.join("./tmp", `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.mp3`);
        try {
            const tts = new EdgeTTS({ voice, rate: rateStr, volume: "+0%" });
            await tts.ttsPromise(sanitizedText, tmpFile);
            await new Promise(r => setTimeout(r, 100));

            if (!fs.existsSync(tmpFile)) throw new Error("File not created");

            const buffer = fs.readFileSync(tmpFile);

            // Cleanup
            for (let i = 0; i < 3; i++) {
                try {
                    fs.unlinkSync(tmpFile);
                    break;
                } catch (e) {
                    if (e.code === 'EBUSY' && i < 2) await new Promise(r => setTimeout(r, 200));
                }
            }

            return buffer;
        } catch (err) {
            lastError = err;
            console.warn(`⚠️ Edge TTS attempt ${attempt}/${maxRetries}: ${err.message}`);
            try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) { }
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }

    throw new Error(`Edge TTS failed after ${maxRetries} retries: ${lastError?.message || 'unknown'}`);
}

export async function mergeAudio(files, outputPath) {
    const listFile = path.join(path.dirname(outputPath), `concat_${Date.now()}.txt`);
    const fileContent = files.map(f => `file '${path.resolve(f).replace(/\\/g, "/")}'`).join("\n");
    fs.writeFileSync(listFile, fileContent);
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(listFile)
            .inputOptions(["-f concat", "-safe 0"])
            .outputOptions(["-c copy"])
            .on("end", () => { fs.unlinkSync(listFile); resolve(); })
            .on("error", reject)
            .save(outputPath);
    });
}

export async function parallelLimit(tasks, limit) {
    const results = [];
    let index = 0;
    async function worker() {
        while (index < tasks.length) {
            const current = index++;
            try {
                results[current] = await tasks[current]();
            } catch (e) {
                results[current] = { error: e };
            }
        }
    }
    const workers = Array(Math.min(limit, tasks.length)).fill(null).map(worker);
    await Promise.all(workers);
    return results;
}

const progressMap = new Map();

export function createProgress(id, total) {
    progressMap.set(id, { total, done: 0, status: "running", file: null, error: null, percent: 0, phase: "tts" });
}

export function updateProgress(id, done) {
    const item = progressMap.get(id);
    if (!item) return;
    item.done = done;
    const percent = ((done / item.total) * 100).toFixed(1);
    item.percent = percent; // Store percent
    const barWidth = 20;
    const filled = Math.round((done / item.total) * barWidth);
    const bar = "█".repeat(filled) + "-".repeat(barWidth - filled);
    process.stdout.write(`\r🎧 Job ${id.slice(0, 6)}: [${bar}] ${percent}% (${done}/${item.total})`);
    if (done === item.total) console.log("");
    progressMap.set(id, item);
}

export function updatePercent(id, percent, phase) {
    const item = progressMap.get(id);
    if (!item) return;
    item.percent = percent;
    if (phase) item.phase = phase;

    const barWidth = 20;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = "█".repeat(filled) + "-".repeat(barWidth - filled);
    process.stdout.write(`\r🎬 ${phase || 'Job'}: [${bar}] ${percent}%`);

    progressMap.set(id, item);
}

export function finishProgress(id, file) {
    const item = progressMap.get(id);
    if (!item) return;
    item.status = "finished";
    item.file = file;
    progressMap.set(id, item);
    console.log(`\n✅ Job ${id.slice(0, 6)} hoàn tất → ${file}`);
}

export function failProgress(id, error) {
    const item = progressMap.get(id) || {};
    item.status = "error";
    item.error = error;
    progressMap.set(id, item);
    console.error(`\n❌ Job ${id.slice(0, 6)} lỗi: ${error}`);
}

export function getProgress(id) {
    return progressMap.get(id);
}
