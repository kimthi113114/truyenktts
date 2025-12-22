import express from "express";
import puppeteer from "puppeteer";

const router = express.Router();

let browser = null;
let page = null;

// Endpoint để mở trình duyệt và chờ user login
router.post("/copilot/init", async (req, res) => {
    try {
        if (browser) {
            return res.json({ message: "Browser already open.", status: "open" });
        }

        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
        });

        page = await browser.newPage();
        await page.goto("https://copilot.microsoft.com", { waitUntil: "networkidle2" });

        // User cần tự login sau bước này
        res.json({ message: "Browser opened. Please log in manually.", status: "opened" });

        // Xử lý khi browser bị tắt thủ công
        browser.on("disconnected", () => {
            console.log("Browser disconnected.");
            browser = null;
            page = null;
        });

    } catch (error) {
        console.error("Init Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Queue Management
const requestQueue = [];
let isProcessing = false;

const processQueue = async () => {
    if (isProcessing || requestQueue.length === 0) return;

    isProcessing = true;
    const { req, res, resolve } = requestQueue.shift();

    try {
        await handleAskRequest(req, res);
    } catch (error) {
        console.error("Queue Processing Error:", error);
        if (!res.headersSent) res.status(500).json({ error: error.message });
    } finally {
        isProcessing = false;
        resolve(); // Signal completion
        processQueue(); // Process next
    }
};

// Logic xử lý chính (Tách ra từ router.post cũ)
const handleAskRequest = async (req, res) => {
    const { text } = req.body;

    if (!text) return res.status(400).json({ error: "Text is required" });
    if (!page || !browser) return res.status(400).json({ error: "Browser not initialized. Call /init first." });

    try {
        // ... (Logic cũ giữ nguyên, nhưng sẽ paste lại vào đây để đảm bảo structure)

        // 1. Tìm ô nhập liệu
        const inputSelector = "textarea, [contenteditable='true'], #userInput";
        try {
            await page.waitForSelector(inputSelector, { timeout: 3000 });
            await page.click(inputSelector);
        } catch (e) {
            console.log("Could not find selector, trying raw keyboard focus...");
        }

        // 2. Clear input cũ (nếu có) - Ctrl+A, Delete
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        // 3. Nhập text (Dùng execCommand)
        await page.evaluate((text) => {
            const el = document.querySelector("textarea, [contenteditable='true'], #userInput");
            if (el) el.focus();
            document.execCommand('insertText', false, text);
        }, text);

        await new Promise(r => setTimeout(r, 800));
        await page.keyboard.press('Enter');

        // 4. Đợi câu trả lời (Smart Wait)
        await new Promise(r => setTimeout(r, 5000));

        const maxWaitTime = 120000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            const isGenerating = await page.evaluate(() => {
                return !!document.querySelector('button[data-testid="stop-button"]');
            });

            if (!isGenerating) {
                console.log("Stop button gone, generation complete.");
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        // Lấy text cuối cùng
        const finalText = await page.evaluate(() => {
            const responses = document.querySelectorAll('div[class*="group/ai-message-item"]');

            if (responses.length > 0) {
                const lastResponse = responses[responses.length - 1];
                return lastResponse.innerText;
            }

            const legacyResponses = document.querySelectorAll('div[data-content="markdown"], .message-content, .ac-textBlock');
            if (legacyResponses.length > 0) {
                return legacyResponses[legacyResponses.length - 1].innerText;
            }

            return "";
        });

        res.json({ response: finalText });

    } catch (error) {
        throw error;
    }
};

// Endpoint để gửi câu hỏi và lấy câu trả lời
router.post("/copilot/ask", async (req, res) => {
    // Đẩy request vào hàng đợi
    // Chúng ta wrap trong Promise để giữ connection HTTP của client cho đến khi đến lượt xử lý
    await new Promise((resolve) => {
        requestQueue.push({ req, res, resolve });
        processQueue();
    });
});

export default router;
