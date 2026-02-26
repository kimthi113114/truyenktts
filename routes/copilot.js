import express from "express";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let browser = null;
const WORKER_COUNT = 4;
let workers = []; // Array of { id: number, page: Page, busy: boolean }

// Kích hoạt plugin ẩn danh
puppeteer.use(StealthPlugin());

// Endpoint để mở trình duyệt và chờ user login
router.post("/copilot/init", async (req, res) => {
    try {
        if (browser && browser.isConnected() && workers.length === WORKER_COUNT) {
            return res.json({ message: "Browser and workers already active.", status: "open", workers: workers.length });
        }

        // Đóng browser cũ nếu bị lỗi kết nối hoặc khởi tạo lại
        if (browser) await browser.close().catch(() => { });
        workers = [];

        console.log("Launching browser for Copilot...");

        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            userDataDir: "./user_data_copilot",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--start-maximized",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-first-run",
                "--no-zygote"
            ]
        });

        console.log(`Initializing ${WORKER_COUNT} workers for Copilot...`);

        // Khởi tạo song song các tab
        const initPromises = Array.from({ length: WORKER_COUNT }, async (_, i) => {
            const page = await browser.newPage();
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            await page.setUserAgent(userAgent);

            // Navigate từng tab
            await page.goto("https://copilot.microsoft.com", { waitUntil: "networkidle2" });

            return { id: i, page, busy: false };
        });

        workers = await Promise.all(initPromises);
        console.log(`All ${WORKER_COUNT} Copilot workers initialized. Waiting 60s for manual login if needed...`);

        // Wait 60 seconds for manual login
        await new Promise(resolve => setTimeout(resolve, 60000));

        console.log("Copilot initialization complete.");
        res.json({ message: `Browser opened with ${WORKER_COUNT} tabs and waited 60s.`, status: "opened" });

        browser.on("disconnected", () => {
            console.log("Copilot browser disconnected.");
            browser = null;
            workers = [];
        });

    } catch (error) {
        console.error("Init Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Logic xử lý chính
const handleAskRequest = async (page, req, res) => {
    let retryCount = 0;
    const maxRetries = 3;
    const { text } = req.body;

    if (!text) return res.status(400).json({ error: "Text is required" });

    while (retryCount < maxRetries) {
        try {
            if (page.isClosed()) {
                throw new Error("Page is closed. Worker dead.");
            }

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

            return res.json({ response: finalText });

        } catch (error) {
            console.error(`Attempt ${retryCount + 1} failed:`, error.message);
            retryCount++;
            if (retryCount >= maxRetries) throw error;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
};

// Queue Management
const requestQueue = [];

const processQueue = async () => {
    if (requestQueue.length === 0) return;

    const availableWorker = workers.find(w => !w.busy);
    if (!availableWorker) return;

    const { req, res, resolve } = requestQueue.shift();
    availableWorker.busy = true;
    console.log(`Copilot Worker ${availableWorker.id} processing request...`);

    (async () => {
        try {
            await handleAskRequest(availableWorker.page, req, res);
        } catch (error) {
            console.error(`Copilot Worker ${availableWorker.id} Error:`, error);
            if (!res.headersSent) res.status(500).json({ error: error.message });
        } finally {
            availableWorker.busy = false;
            console.log(`Copilot Worker ${availableWorker.id} free.`);
            resolve();
            processQueue();
        }
    })();

    processQueue();
};

router.post("/copilot/ask", async (req, res) => {
    if (!browser || workers.length === 0) {
        return res.status(400).json({ error: "Browser not initialized. Call /init first." });
    }

    await new Promise((resolve) => {
        requestQueue.push({ req, res, resolve });
        processQueue();
    });
});

export default router;
