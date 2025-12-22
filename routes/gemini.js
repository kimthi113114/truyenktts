import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the system instruction from readme1.md
const readmePath = path.join(__dirname, "../readme1.md");
let systemInstruction = "";

try {
    if (fs.existsSync(readmePath)) {
        systemInstruction = fs.readFileSync(readmePath, "utf-8");
    } else {
        console.warn("Warning: readme1.md not found for Gemini system instruction.");
    }
} catch (err) {
    console.error("Error reading readme1.md:", err);
}

// --- CẤU HÌNH CONCURRENCY (XỬ LÝ ĐỒNG THỜI) ---
const MAX_CONCURRENT_REQUESTS = 3; // Giới hạn 3 request cùng lúc
let activeRequests = 0; // Biến đếm số request đang chạy
const requestQueue = []; // Hàng đợi chứa các request đang chờ (thứ 4 trở đi)

// Hàm kiểm tra hàng đợi để gọi người tiếp theo
const processNextRequest = () => {
    // Giảm số lượng đang active xuống vì 1 request vừa xong
    activeRequests--;

    // Nếu hàng đợi còn người chờ, lôi người đầu tiên ra và cho phép chạy
    if (requestQueue.length > 0) {
        const nextResolve = requestQueue.shift();
        nextResolve(); // Giải phóng Promise đang chờ (await) ở dưới
        // Lưu ý: Khi nextResolve() chạy, request kia sẽ đi qua dòng await và tăng activeRequests lên lại
    }
};

router.post("/gemini", async (req, res) => {
    const { apiKey, text } = req.body;

    if (!apiKey) {
        return res.status(400).json({ error: "API Key is required" });
    }

    if (!text) {
        return res.status(400).json({ error: "Text is required" });
    }

    // --- BẮT ĐẦU LOGIC CHỜ (QUEUE) ---
    if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        // Nếu đã đủ 3 người, request thứ 4 sẽ nằm lại đây chờ
        await new Promise((resolve) => {
            requestQueue.push(resolve);
        });
    }

    // Khi đi qua được đoạn await trên (hoặc không phải chờ), tăng biến đếm
    activeRequests++;
    // ---------------------------------

    try {
        //gemini-3-pro-preview
        const genAI = new GoogleGenerativeAI(apiKey);//gemini-2.5-pro
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });//gemini-2.5-flash

        const prompt = `${systemInstruction}\n\n${text}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const generatedText = response.text();

        res.json({ text: generatedText });
    } catch (error) {
        console.error("Gemini API Error:", error);
        res.status(500).json({ error: error.message || "Failed to generate content" });
    } finally {
        // --- KẾT THÚC REQUEST (QUAN TRỌNG) ---
        // Dù thành công hay thất bại (vào catch), code vẫn sẽ chạy vào đây
        // để báo hiệu request đã xong và gọi người tiếp theo
        processNextRequest();
    }
});

export default router;