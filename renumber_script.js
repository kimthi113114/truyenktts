import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputFile = path.join(__dirname, 'data', 'MayMau.txt');
const outputFile = path.join(__dirname, 'data', 'MayMau_Renumbered.txt');

console.log(`Reading file: ${inputFile}`);
const content = fs.readFileSync(inputFile, 'utf8');

// Regex to find chapters. Assumes format "Chương <number>:" or similar.
const chapterRegex = /^Chương\s+\d+.*$/gm;
let match;
const indices = [];

while ((match = chapterRegex.exec(content)) !== null) {
    indices.push({ start: match.index, title: match[0].trim() });
}

console.log(`Found ${indices.length} original chapters.`);

let newContent = "";
let newChapterIndex = 1;

if (indices.length === 0) {
    console.log("No chapters found matching regex. Processing as single block.");
    processChapterContent(content, "Nội dung chính");
} else {
    for (let i = 0; i < indices.length; i++) {
        const start = indices[i].start;
        const end = (i + 1 < indices.length) ? indices[i + 1].start : content.length;
        const chapterContent = content.substring(start, end);

        // Extract title and body
        // The title is indices[i].title, but we want to remove the old "Chương X" part if we can, 
        // or just keep the text part. 
        // Let's try to keep the descriptive part of the title.
        // Example: "Chương 1: Nhặt xác" -> "Nhặt xác"
        let titleText = indices[i].title;
        const colonIndex = titleText.indexOf(':');
        if (colonIndex !== -1) {
            titleText = titleText.substring(colonIndex + 1).trim();
        } else {
            // If no colon, maybe space? "Chương 1 Nhặt xác"
            const parts = titleText.split(/\s+/);
            if (parts.length > 2) {
                // "Chương", "1", "Nhặt", "xác" -> join from index 2
                titleText = parts.slice(2).join(' ');
            }
        }

        // If titleText is still empty or just numbers, fallback to original or generic
        if (!titleText || /^\d+$/.test(titleText)) {
            titleText = indices[i].title;
        }

        // Remove the original title line from content to avoid duplication if we are rewriting it
        // The regex matched the title line. The 'start' index is where it begins.
        // We need to find where the title line ends.
        const firstLineEnd = chapterContent.indexOf('\n');
        let body = chapterContent;
        if (firstLineEnd !== -1) {
            body = chapterContent.substring(firstLineEnd + 1);
        }

        processChapterContent(body, titleText);
    }
}

function processChapterContent(text, titleBase) {
    const CHUNK_SIZE = 8000;
    let currentIndex = 0;

    // If text is empty, just skip
    if (!text.trim()) return;
    let index = 1;
    while (currentIndex < text.length) {
        let endIndex = Math.min(currentIndex + CHUNK_SIZE, text.length);

        // If not at the end, try to find a newline to break at
        if (endIndex < text.length) {
            // Look for newline in the last 20% of the chunk
            const lastNewline = text.lastIndexOf('\n', endIndex);
            if (lastNewline > currentIndex + CHUNK_SIZE * 0.8) {
                endIndex = lastNewline + 1;
            } else {
                const lastPeriod = text.lastIndexOf('.', endIndex);
                if (lastPeriod > currentIndex + CHUNK_SIZE * 0.8) {
                    endIndex = lastPeriod + 1;
                }
            }
        }

        const chunk = text.substring(currentIndex, endIndex).trim();

        if (chunk.length > 0) {
            newContent += `Chương ${newChapterIndex}: ${titleBase} ${index == 1 ? "" : "(" + index + ")"}\n\n`;
            newContent += chunk + "\n\n";
            newChapterIndex++;
        }

        index++;
        currentIndex = endIndex;
    }
}

fs.writeFileSync(outputFile, newContent);
console.log(`Written renumbered content to: ${outputFile}`);
console.log(`Total new chapters: ${newChapterIndex - 1}`);
