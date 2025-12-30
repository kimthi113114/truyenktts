import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

const DATA_ROOT = path.join(__dirname, "../data/data/truyen");

// Regex to match: === Chương 1: Title ===
const CHAPTER_REGEX = /^===\s*Chương\s+(\d+)\s*:\s*(.+?)\s*===$/;


/**
 * Helper to parse story file
 */
function parseStoryFile(filePath) {
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const chapters = [];

    lines.forEach((line, index) => {
        const match = line.trim().match(CHAPTER_REGEX);
        if (match) {
            chapters.push({
                chapter: parseInt(match[1], 10),
                title: match[2],
                line: index + 1 // 1-based line number for reference
            });
        }
    });

    return { lines, chapters };
}

// GET /api/offline/story/:filename/chapters
router.get("/offline/story/:filename/chapters", (req, res) => {
    const { filename } = req.params;
    const safeFilename = path.basename(filename + ".txt");
    const filePath = path.join(DATA_ROOT, safeFilename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Story file not found" });
    }

    try {
        const { chapters } = parseStoryFile(filePath);
        let i = 0;
        for (const chapter of chapters) {

            if (chapter.chapter !== i + 1) {

                console.log(`================== `);
                console.log(`Chapter ${chapter.chapter}: ${chapter.title}`);
            }
            i++;
        }
        console.log(`Total chapters: ${i}`);
        res.json({ filename: safeFilename, totalChapters: chapters.length, chapters });
    } catch (e) {
        res.status(500).json({ error: "Failed to parse story file" });
    }
});

// GET /api/offline/story/:filename/chapter/:chapterNumber
router.get("/offline/story/:filename/chapter/:chapterNumber", (req, res) => {
    const { filename, chapterNumber } = req.params;
    const safeFilename = path.basename(filename + ".txt");
    const filePath = path.join(DATA_ROOT, safeFilename);
    const targetChapter = parseInt(chapterNumber, 10);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Story file not found" });
    }

    try {
        const { lines, chapters } = parseStoryFile(filePath);
        const chapterIndex = chapters.findIndex(c => c.chapter === targetChapter);

        if (chapterIndex === -1) {
            return res.status(404).json({ error: "Chapter not found" });
        }

        const currentChapter = chapters[chapterIndex];
        const nextChapter = chapters[chapterIndex + 1];

        // Start line (0-indexed) is currentChapter.line - 1
        // Usually the content starts AFTER the header line.
        const startIdx = currentChapter.line;

        // End line is the start of next chapter, or end of file
        const endIdx = nextChapter ? nextChapter.line - 1 : lines.length;

        // Extract lines
        const contentLines = lines.slice(startIdx, endIdx);
        const content = contentLines.join("\n").trim();

        res.json({
            chapter: currentChapter.chapter,
            title: currentChapter.title,
            content
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to read chapter content" });
    }
});

export default router;
