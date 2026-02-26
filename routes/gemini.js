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
const MAX_CONCURRENT_REQUESTS = 2; // Giới hạn 3 request cùng lúc
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

const API_KEYS = [
    "AIzaSyA6cKh_saJQrZYISTNdPV4SXLWuBNJk0VA",
    "AIzaSyDmmKrwCreh9WLfD4TTtcWkZz8gx6Gyj8Y",
    "AIzaSyAvsqTzvmcto1--GudPZpVN7vhxuct7aSs",
    "AIzaSyA0KfOrfhqlvAVUG_MJgCkqipkd26Dgwh4",
    "AIzaSyADBDPeC3fZmP_uxcZ11MNxUkNsb0dWHhs"
];
const keyErrorCounts = {};

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

    const generateContentWithRetry = async (prompt, modelName = "gemini-2.5-flash", maxRetries = 5) => {
        let lastError;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            // Lọc các key còn dùng được (bị 429 dưới 5 lần)
            const validKeys = API_KEYS.filter(key => (keyErrorCounts[key] || 0) < 5);

            if (validKeys.length === 0) {
                throw new Error("All API keys have exceeded the limit of 5 429 errors.");
            }

            // Pick a key based on attempt number (simple rotation)
            const keyIndex = (activeRequests + attempt) % validKeys.length;
            const currentApiKey = validKeys[keyIndex];

            try {
                const genAI = new GoogleGenerativeAI(currentApiKey);
                const model = genAI.getGenerativeModel({ model: modelName });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                return response.text();

            } catch (error) {
                lastError = error;
                const is429 = error.message?.includes("429");

                if (is429) {
                    keyErrorCounts[currentApiKey] = (keyErrorCounts[currentApiKey] || 0) + 1;
                    console.warn(`Key ...${currentApiKey.slice(-4)} returned 429. Count: ${keyErrorCounts[currentApiKey]}`);
                }

                const isRetryable = error.message?.includes("503") ||
                    is429 ||
                    error.message?.includes("Overloaded");

                if (isRetryable && attempt < maxRetries - 1) {
                    const delay = 2000 * (attempt + 1); // Exponential backoff-ish: 2s, 4s, 6s...
                    console.warn(`Attempt ${attempt + 1} failed with key ...${currentApiKey.slice(-4)}. Retrying in ${delay}ms... Error: ${error.message}`);
                    await new Promise(res => setTimeout(res, delay));
                } else {
                    // If not retryable or last attempt, throw
                    if (!isRetryable) throw error;
                }
            }
        }
        throw lastError;
    };

    try {
        const prompt = `${systemInstruction}\n\n${text}`;

        // Use the new retry function
        const generatedText = await generateContentWithRetry(prompt, "gemini-2.5-flash");

        res.json({ text: generatedText });
    } catch (error) {
        console.error("Gemini API All Retries Failed:", error);
        res.status(500).json({ error: error.message || "Failed to generate content after retries" });
    } finally {
        // --- KẾT THÚC REQUEST (QUAN TRỌNG) ---
        // Dù thành công hay thất bại (vào catch), code vẫn sẽ chạy vào đây
        // để báo hiệu request đã xong và gọi người tiếp theo
        processNextRequest();
    }
});

export default router;