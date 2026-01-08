import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";

const THEMES = {
    "co-trang": { bgColor: "#f5e6d3", titleColor: "#d32f2f", chapterColor: "#1976d2", textColor: "#424242" },
    "hien-dai": { bgColor: "#2d3748", titleColor: "#f44336", chapterColor: "#2196f3", textColor: "#f7fafc" },
    "toi": { bgColor: "#1a1a1a", titleColor: "#ff5252", chapterColor: "#64b5f6", textColor: "#ffffff" },
    "sang": { bgColor: "#f7fafc", titleColor: "#c62828", chapterColor: "#1565c0", textColor: "#37474f" }
};

export async function createVideoFromAudioMultiChapter(audioPath, chapters, coverPath, outputPath, theme = "toi", storyTitle = "", author = "", website = "", onProgress) {
    const themeConfig = THEMES[theme] || THEMES["toi"];
    const { bgColor, titleColor, chapterColor, textColor } = themeConfig;

    console.log("📁 Cover path:", coverPath);
    console.log("✅ Cover exists:", fs.existsSync(coverPath));

    const coverExists = fs.existsSync(coverPath);

    // Get audio duration first to calculate progress
    const getAudioDuration = () => {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) return reject(err);
                resolve(metadata.format.duration);
            });
        });
    };

    const duration = await getAudioDuration();
    console.log(`🎵 Audio duration: ${duration}s`);

    return new Promise((resolve, reject) => {
        const command = ffmpeg();

        command.input(`color=c=${bgColor}:s=640x720:r=30`).inputFormat("lavfi");

        if (coverExists) {
            command.input(coverPath).inputOptions(["-loop 1"]);
        } else {
            command.input(`color=c=${bgColor}:s=640x720:r=30`).inputFormat("lavfi");
        }

        command.input(audioPath);

        const filters = [];

        if (coverExists) {
            filters.push({ filter: "scale", options: "640:720:force_original_aspect_ratio=decrease", inputs: "[1:v]", outputs: "[scaled]" });
            filters.push({ filter: "pad", options: `640:720:(ow-iw)/2:(oh-ih)/2:color=${bgColor}`, inputs: "[scaled]", outputs: "[cover]" });
        } else {
            filters.push({ filter: "null", inputs: "[1:v]", outputs: "[cover]" });
        }

        filters.push({ filter: "hstack", options: "inputs=2", inputs: ["[0:v]", "[cover]"], outputs: "[stacked]" });

        filters.push({
            filter: "drawtext",
            options: { text: storyTitle || "Story Title", fontcolor: titleColor, fontsize: 36, x: 20, y: 20, fontfile: "C\\\\:/Windows/Fonts/arialbd.ttf" },
            inputs: "[stacked]",
            outputs: "[t1]"
        });

        filters.push({
            filter: "drawtext",
            options: { text: `Tac gia, ${author || "Author"}`, fontcolor: textColor, fontsize: 20, x: 20, y: 70, fontfile: "C\\\\:/Windows/Fonts/arial.ttf" },
            inputs: "[t1]",
            outputs: "[t2]"
        });

        filters.push({
            filter: "drawtext",
            options: { text: `Thuc hien, ${website || "website.com"}`, fontcolor: textColor, fontsize: 20, x: 20, y: 100, fontfile: "C\\\\:/Windows/Fonts/arial.ttf" },
            inputs: "[t2]",
            outputs: "[t3]"
        });

        const tapNumber = chapters[0]?.number || "1";
        filters.push({
            filter: "drawtext",
            options: { text: `Tap ${tapNumber}`, fontcolor: textColor, fontsize: 24, x: 20, y: 150, fontfile: "C\\\\:/Windows/Fonts/arialbd.ttf" },
            inputs: "[t3]",
            outputs: "[t4]"
        });

        let currentY = 190;
        let lastOutput = "[t4]";

        chapters.slice(0, 10).forEach((ch, idx) => {
            const nextOutput = idx === chapters.slice(0, 10).length - 1 ? "[final]" : `[ch${idx}]`;
            const title = ch.title || "";
            const maxLen = 45;
            const displayTitle = title.length > maxLen ? title.substring(0, maxLen - 3) + "..." : title;
            const chapterText = `Chuong ${ch.number}, ${displayTitle}`;

            filters.push({
                filter: "drawtext",
                options: { text: chapterText, fontcolor: chapterColor, fontsize: 18, x: 20, y: currentY, fontfile: "C\\\\:/Windows/Fonts/arial.ttf" },
                inputs: lastOutput,
                outputs: nextOutput
            });
            lastOutput = nextOutput;
            currentY += 30;
        });

        command
            .complexFilter(filters, "[final]")
            .outputOptions([
                "-map 2:a",
                "-shortest",
                "-pix_fmt yuv420p",
                "-c:v libx264",
                "-preset medium",
                "-crf 23",
                "-c:a aac",
                "-b:a 128k",
                "-ar 44100",
                "-movflags +faststart"
            ])
            .on("start", (cmd) => {
                console.log("🎬 Starting video generation...");
            })
            .on("progress", (p) => {
                let percent = 0;
                if (p.percent) {
                    percent = p.percent;
                } else if (p.timemark) {
                    const [hours, minutes, seconds] = p.timemark.split(':');
                    const currentSeconds = (+hours) * 60 * 60 + (+minutes) * 60 + (+seconds);
                    percent = (currentSeconds / duration) * 100;
                }

                percent = Math.min(Math.max(percent, 0), 100).toFixed(1);

                const barWidth = 20;
                const filled = Math.round((percent / 100) * barWidth);
                const bar = "█".repeat(filled) + "-".repeat(barWidth - filled);
                process.stdout.write(`\r🎬 Video: [${bar}] ${percent}%`);
                if (onProgress) onProgress(percent);
            })
            .on("end", () => {
                console.log("\n✅ Video completed");
                resolve();
            })
            .on("error", (err, stdout, stderr) => {
                console.error("❌ Video error:", err.message);
                console.error("FFmpeg stderr:", stderr);
                reject(err);
            })
            .save(outputPath);
    });
}

export { THEMES };
