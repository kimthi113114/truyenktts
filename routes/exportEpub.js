import express from "express";
import Epub from "epub-gen";
import path from "path";
import { fileURLToPath } from "url";
import dSachTruyen from "../data/dSachTruyen.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();



router.post("/export-epub", async (req, res) => {
    try {
        const { chapters,
        } = req.body;
        const { title, author, cover } = dSachTruyen[dSachTruyen.length - 1];
        if (!chapters || typeof chapters !== "object") {
            return res.status(400).json({ error: "Thiếu dữ liệu chapters" });
        }

        const keys = Object.keys(chapters);
        const first = keys[0];
        const last = keys[keys.length - 1];

        console.log("title", title);
        console.log("author", author);
        console.log("cover", cover);

        const content = keys.map((num, idx) => {
            const { chapterTitle, text } = chapters[num];
            const cleanText = (text || "")
                .replace(/\r\n/g, "\n")
                .replace(/\n{2,}/g, "</p><p>")
                .replace(/\n/g, "<br/>");

            const header = `Chương ${num}${chapterTitle ? ": " + chapterTitle : ""}`;
            return { title: header, data: `<p>${cleanText}</p>` };
        });

        const filename = `${title}_${first}-${last}_${Date.now()}.epub`;
        const outputPath = path.join(__dirname, "../output/", filename);

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
            title: `${title} ${first}-${last}`, author, language: "vi",
            output: outputPath,
            content,
            cover: coverImagePath, // 👈 đây chính là phần thêm ảnh bìa
            fonts: [
                path.join(__dirname, "../fonts", "9599-Seravek-Basic.ttf"),
            ],
            css: `
                    * {
                    font-family: 'Seravek Basic', serif;
                    line-height: 1.7;
                    }
                    p {
                    margin: 0.4em 0;
                    text-indent: 2em;
                    }
                    h1, h2, h3 {
                    text-indent: 0;
                    text-align: center;
                    margin: 1.5em 0 1em;
                    }
                `,
        }).promise;
        res.json({ success: true, file: `/${filename}` });
    } catch (err) {
        res.status(500).json({ error: "Không thể export EPUB", detail: String(err) });
    }
});

export default router;
