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

router.get("/chatgpt/init", async (req, res) => {
    try {
        if (browser && browser.isConnected() && workers.length === WORKER_COUNT) {
            return res.json({ message: "Browser and workers already active.", status: "open", workers: workers.length });
        }

        // Đóng browser cũ nếu bị lỗi kết nối hoặc khởi tạo lại
        if (browser) await browser.close().catch(() => { });
        workers = [];

        console.log("Launching browser...");
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

        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            // ⚠️ QUAN TRỌNG: Hãy trỏ đến Chrome thật trên máy bạn.
            // Nếu bạn dùng Windows, hãy bỏ comment dòng dưới và sửa đường dẫn nếu cần:
            executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",

            // Nếu bạn dùng MacOS, bỏ comment dòng này:
            // executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",

            userDataDir: "./user_data",

            // ⚠️ QUAN TRỌNG: BỎ dòng ignoreDefaultArgs đi. 
            // Dòng đó gây crash khi redirect trang login. Chấp nhận hiện thanh thông báo để đổi lấy sự ổn định.
            // ignoreDefaultArgs: ["--enable-automation"], 

            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--start-maximized",
                "--disable-blink-features=AutomationControlled",
                // Thêm các cờ này để chống crash bộ nhớ/GPU
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-first-run",
                "--no-zygote"
            ]
        });

        console.log(`Initializing ${WORKER_COUNT} workers...`);

        // Khởi tạo song song các tab
        const initPromises = Array.from({ length: WORKER_COUNT }, async (_, i) => {
            const page = await browser.newPage();
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            await page.setUserAgent(userAgent);

            // Navigate từng tab
            await page.goto("https://chatgpt.com", { waitUntil: "networkidle2" });


            // // 1. Selector Definitions
            // const inputSelector = '#prompt-textarea';
            // const sendButtonSelector = 'button#composer-submit-button';
            // const stopButtonSelector = '[aria-label="Stop streaming"]';
            // try {
            //     await page.waitForSelector(inputSelector, { timeout: 5000 });
            // } catch (e) {
            //     // If selector missing, maybe a reload helps?
            //     console.warn("Input selector missing, reloading page...");
            //     await page.reload({ waitUntil: "networkidle2" });
            //     await page.waitForSelector(inputSelector, { timeout: 10000 });
            // }

            // await page.focus(inputSelector);
            // await page.keyboard.down('Control');
            // await page.keyboard.press('A');
            // await page.keyboard.up('Control');
            // await page.keyboard.press('Backspace');

            // // 3. Type text (Robust method)
            // await page.focus(inputSelector);
            // await page.evaluate((selector, text) => {
            //     const el = document.querySelector(selector);
            //     if (el) {
            //         el.innerText = text;
            //         el.dispatchEvent(new Event('input', { bubbles: true }));
            //         el.dispatchEvent(new Event('change', { bubbles: true }));
            //     }
            // }, inputSelector, systemInstruction);

            // // Trigger React state
            // await page.type(inputSelector, ' ');
            // await page.keyboard.press('Backspace');
            // await page.keyboard.press('Enter');

            return { id: i, page, busy: false };
        });

        workers = await Promise.all(initPromises);
        console.log(`All ${WORKER_COUNT} workers initialized.`);

        res.json({ message: `Browser opened with ${WORKER_COUNT} tabs.`, status: "opened" });

        browser.on("disconnected", () => {
            console.log("Browser disconnected.");
            browser = null;
            workers = [];
        });

    } catch (error) {
        console.error("Init Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Logic xử lý chính (Updated to accept page param)
const handleAskRequest = async (page, req, res) => {
    let retryCount = 0;
    const maxRetries = 3;
    const { text } = req.body;

    if (!text) return res.status(400).json({ error: "Text is required" });

    while (retryCount < maxRetries) {
        try {
            // Check page status
            if (page.isClosed()) {
                throw new Error("Page is closed. Worker dead.");
            }

            // Wait a bit before starting
            await new Promise(r => setTimeout(r, 1000));

            // 1. Selector Definitions
            const inputSelector = '#prompt-textarea';
            const sendButtonSelector = 'button#composer-submit-button';
            const stopButtonSelector = '[aria-label="Stop streaming"]';

            // Ensure we are on the right page
            // if (page.url() !== "https://chatgpt.com/") {
            //     // Try to reload or navigate if off-piste
            //     console.log(`Worker page at ${page.url()}, navigating to chatgpt.com...`);
            //     await page.goto("https://chatgpt.com", { waitUntil: "networkidle2" });
            // }

            // 2. Clear input safely
            try {
                await page.waitForSelector(inputSelector, { timeout: 5000 });
            } catch (e) {
                // If selector missing, maybe a reload helps?
                console.warn("Input selector missing, reloading page...");
                await page.reload({ waitUntil: "networkidle2" });
                await page.waitForSelector(inputSelector, { timeout: 10000 });
            }

            await page.focus(inputSelector);
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');

            // 3. Type text (Robust method)
            await page.focus(inputSelector);
            await page.evaluate((selector, text) => {
                const el = document.querySelector(selector);
                if (el) {
                    el.innerText = text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, inputSelector, text.replaceAll("·", ""));

            // Trigger React state
            await page.type(inputSelector, ' ');
            await page.keyboard.press('Backspace');

            // 4. Click Send
            try {

                await new Promise(r => setTimeout(r, 2000));
                await page.keyboard.press('Enter');

                // // Wait for button to be clickable
                // await page.waitForSelector(sendButtonSelector, { visible: true, timeout: 30000 });
                // await new Promise(r => setTimeout(r, 500));
                // await page.click(sendButtonSelector);
            } catch (err) {

                await page.keyboard.press('Enter');
                // Fallback: Click via DOM evaluate if puppeteer click fails
                // const clicked = await page.evaluate((sel) => {
                //     const btn = document.querySelector(sel);
                //     if (btn) { btn.click(); return true; }
                //     return false;
                // }, sendButtonSelector);
                // if (!clicked) throw new Error("Could not click send button");
            }

            // 5. Wait for Response (Start generating -> Stop generating)
            try {
                await page.waitForSelector(stopButtonSelector, { visible: true, timeout: 5000 });
            } catch (e) {
                // Maybe it was too fast? check if response is already there?
                // continue to wait for hidden
                throw new Error("Could not find stop button");
            }

            // Wait for generation to finish (Stop button disappears)
            await page.waitForSelector(stopButtonSelector, { hidden: true, timeout: 120000 }); // 2 mins max generation

            // 6. Get Last Response
            const finalResponse = await page.evaluate(() => {
                const assistantMessages = document.querySelectorAll('div[data-message-author-role="assistant"]');
                if (assistantMessages.length > 0) {
                    const lastMessage = assistantMessages[assistantMessages.length - 1];
                    const markdownContent = lastMessage.querySelector('.markdown');
                    return markdownContent ? markdownContent.innerText : lastMessage.innerText;
                }
                return "";
            });

            if (!finalResponse) throw new Error("Empty response from ChatGPT");

            // Format Logic
            const formattedResponse = finalResponse.replace(/\n/g, '\n\n').replace(/\n{3,}/g, '\n\n');

            return res.json({ response: formattedResponse });

        } catch (error) {
            console.error(`Attempt ${retryCount + 1} failed:`, error.message);
            retryCount++;

            if (retryCount >= maxRetries) {
                // Return error to be handled by the caller or queue
                throw error;
            }

            // Wait before retry
            await new Promise(r => setTimeout(r, 2000));
        }
    }
};

// Queue Management (Updated for Worker Pool)
const requestQueue = [];

const processQueue = async () => {
    if (requestQueue.length === 0) return;

    // Tìm worker rảnh
    const availableWorker = workers.find(w => !w.busy);
    if (!availableWorker) return; // Không có worker rảnh, đợi lần sau

    // Lấy request từ queue
    const { req, res, resolve } = requestQueue.shift();

    // Đánh dấu worker đang bận
    availableWorker.busy = true;
    console.log(`Worker ${availableWorker.id} processing request...`);

    // Xử lý async để không block main thread
    (async () => {
        try {
            await handleAskRequest(availableWorker.page, req, res);
        } catch (error) {
            console.error(`Worker ${availableWorker.id} Error:`, error);
            if (!res.headersSent) res.status(500).json({ error: error.message });
        } finally {
            // Giải phóng worker
            availableWorker.busy = false;
            console.log(`Worker ${availableWorker.id} free.`);
            resolve();
            // Gọi lại queue để xử lý tiếp nếu còn
            processQueue();
        }
    })();

    // Tiếp tục kiểm tra queue xem còn worker khác rảnh không (để chạy song song ngay lập tức)
    processQueue();
};

router.post("/chatgpt/ask", async (req, res) => {
    if (!browser || workers.length === 0) {
        return res.status(400).json({ error: "Browser not initialized. Call /init first." });
    }

    await new Promise((resolve) => {
        requestQueue.push({ req, res, resolve });
        processQueue();
    });
});

export default router;
