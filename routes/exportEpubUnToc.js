import express from "express";
import Epub from "epub-gen";
import path from "path";
import { fileURLToPath } from "url";

import fs from "fs";
import dSachTruyen from "../data/dSachTruyen.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();



router.post("/export-epub-unToc", async (req, res) => {
  try {
    const { chapters
    } = req.body;
    const { title, author, cover } = dSachTruyen[dSachTruyen.length - 1];

    const keys = Object.keys(chapters)
      .map(k => parseInt(k, 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    const first = keys[0];
    const last = keys[keys.length - 1];

    const chunkSize = 50;
    const content = [];

    // Gom theo mốc cố định 1–50, 51–100, 101–150,...
    const minRange = Math.floor((first - 1) / chunkSize) * chunkSize + 1;
    const maxRange = Math.ceil(last / chunkSize) * chunkSize;

    for (let start = minRange; start <= maxRange; start += chunkSize) {
      const end = start + chunkSize - 1;
      const group = keys.filter(num => num >= start && num <= end);

      if (group.length === 0) continue;

      const mergedHtml = group
        .map(num => {
          const { chapterTitle, text } = chapters[num] || {};
          const cleanText = (text || "")
            .replace(/\r\n/g, "\n")
            .replace(/\n{2,}/g, "</p><p>")
            .replace(/\n/g, "<br/>");
          return `<h2>Chương ${num}${chapterTitle ? ": " + chapterTitle : ""}</h2><p>${cleanText}</p>`;
        })
        .join("<br/><br/><br/>");

      content.push({
        title: `Chương ${start} - ${end}`,
        data: mergedHtml
      });
    }

    const filename = `${title}_${first}-${last}_untoc_${Date.now()}.epub`;
    const outputPath = path.join(__dirname, "../output", filename);

    let coverImagePath = undefined;
    if (cover) {
      if (cover.startsWith("http")) {
        // tải tạm ảnh về
        const coverPath = path.join(__dirname, "../output", "cover_temp.jpg");
        const response = await fetch(_cover);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(coverPath, Buffer.from(buffer));
        coverImagePath = coverPath;
      } else {
        // dùng file cục bộ
        coverImagePath = path.join(__dirname, "../covers", cover);
      }
    }

    await new Epub({
      title: `${title} ${first}-${last}`,
      author: author,
      language: "vi",
      output: outputPath,
      cover: coverImagePath, // 👈 đây chính là phần thêm ảnh bìa
      content
    }).promise;

    res.json({ success: true, file: `/${filename}` });
  } catch (err) {
    res.status(500).json({ error: "Không thể export EPUB", detail: String(err) });
  }
});

export default router;
