import express from "express";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";
const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let browsers = []; // Array of browser instances (one per worker)
const WORKER_COUNT = 4;
let workers = []; // Array of { id: number, browser: Browser, page: Page, busy: boolean }

// System instruction từ readme1.md (dùng chung cho init và retry)
let systemInstruction = "";
const readmePath = path.join(__dirname, "../readme1.md");
try {
    if (fs.existsSync(readmePath)) {
        systemInstruction = fs.readFileSync(readmePath, "utf-8");
    } else {
        console.warn("Warning: readme1.md not found for system instruction.");
    }
} catch (err) {
    console.error("Error reading readme1.md:", err);
}



// Kích hoạt plugin ẩn danh
puppeteer.use(StealthPlugin());

router.get("/chatgpt/init", async (req, res) => {
    try {
        // Check if all browsers are still connected
        const allConnected = browsers.length === WORKER_COUNT && browsers.every(b => b && b.isConnected());
        if (allConnected && workers.length === WORKER_COUNT) {
            return res.json({ message: "All browser windows and workers already active.", status: "open", workers: workers.length });
        }

        // Đóng tất cả browser cũ nếu cần khởi tạo lại
        for (const b of browsers) {
            if (b) await b.close().catch(() => { });
        }
        browsers = [];
        workers = [];

        console.log(`Launching ${WORKER_COUNT} browser windows...`);
        // Reload systemInstruction từ file tại thời điểm init
        try {
            if (fs.existsSync(readmePath)) {
                systemInstruction = fs.readFileSync(readmePath, "utf-8");
            }
        } catch (err) {
            console.error("Error reading readme1.md:", err);
        }

        console.log(`Initializing ${WORKER_COUNT} workers (each in separate window)...`);

        // Khởi tạo song song các browser (mỗi cửa sổ riêng)
        const initPromises = Array.from({ length: WORKER_COUNT }, async (_, i) => {
            // Mỗi worker có userDataDir riêng để tránh xung đột
            const workerBrowser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                userDataDir: `./user_data/user_data_worker_${i}`,
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

            browsers.push(workerBrowser);

            const page = await workerBrowser.newPage();
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            await page.setUserAgent(userAgent);

            // Navigate
            await page.goto("https://chatgpt.com", { waitUntil: "networkidle2" });

            // 1. Selector Definitions
            const inputSelector = '#prompt-textarea';
            const sendButtonSelector = 'button#composer-submit-button';
            const stopButtonSelector = '[aria-label="Stop streaming"]';

            try {
                // Wait for input selector to appear (might need login)
                await page.waitForSelector(inputSelector, { timeout: 15000 });

                // 2. Clear input safely
                await page.focus(inputSelector);
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');

                // 3. Type system instruction (Robust method using evaluate)
                console.log(`Worker ${i} (window ${i}) submitting system instruction...`);
                await page.evaluate((selector, text) => {
                    const el = document.querySelector(selector);
                    if (el) {
                        // ProseMirror editor sử dụng <p> tags cho mỗi đoạn văn
                        // Escape HTML để tránh XSS
                        const escapeHtml = (str) => str
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;')
                            .replace(/'/g, '&#039;');

                        // Split theo \n và wrap mỗi dòng trong <p> tag
                        const lines = text.split('\n');
                        const htmlContent = lines.map(line => {
                            const escaped = escapeHtml(line);
                            return `<p>${escaped || ''}</p>`;
                        }).join('');

                        el.innerHTML = htmlContent;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, inputSelector, systemInstruction);

                // Trigger React state and submit
                await page.type(inputSelector, ' ');
                await page.keyboard.press('Backspace');
                await page.keyboard.press('Enter');

                // 4. Wait for generation to finish
                try {
                    await page.waitForSelector(stopButtonSelector, { visible: true, timeout: 5000 });
                    await page.waitForSelector(stopButtonSelector, { hidden: true, timeout: 60000 });
                    console.log(`Worker ${i} (window ${i}) system instruction processed.`);
                } catch (e) {
                    console.warn(`Worker ${i} did not show stop button, maybe instruction was short or already finished.`);
                }

            } catch (e) {
                console.warn(`Worker ${i} could not submit system instruction: ${e.message}`);
            }

            // Handle browser disconnect
            workerBrowser.on("disconnected", () => {
                console.log(`Browser window ${i} disconnected.`);
                const workerIndex = workers.findIndex(w => w.id === i);
                if (workerIndex !== -1) {
                    workers.splice(workerIndex, 1);
                }
                const browserIndex = browsers.indexOf(workerBrowser);
                if (browserIndex !== -1) {
                    browsers.splice(browserIndex, 1);
                }
            });

            return { id: i, browser: workerBrowser, page, busy: false };
        });

        workers = await Promise.all(initPromises);
        console.log(`All ${WORKER_COUNT} workers initialized in separate windows. Waiting 60s for manual login if needed...`);

        // Wait 60 seconds as requested
        await new Promise(resolve => setTimeout(resolve, 60000));

        console.log("Initialization complete.");
        res.json({ message: `${WORKER_COUNT} browser windows opened and waited 60s.`, status: "opened" });

    } catch (error) {
        console.error("Init Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Logic xử lý chính (Updated to accept page param)
const handleAskRequest = async (page, req, res) => {
    let retryCount = 0;
    const maxRetries = 5;
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
                    // ProseMirror editor sử dụng <p> tags cho mỗi đoạn văn
                    // Escape HTML để tránh XSS
                    const escapeHtml = (str) => str
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#039;');

                    // Split theo \n và wrap mỗi dòng trong <p> tag
                    const lines = text.split('\n');
                    const htmlContent = lines.map(line => {
                        const escaped = escapeHtml(line);
                        return `<p>${escaped || ''}</p>`;
                    }).join('');

                    el.innerHTML = htmlContent;
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
            await page.waitForSelector(stopButtonSelector, { hidden: true, timeout: 300000 }); // 2 mins max generation

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

            // Check if response is too short compared to original request
            if (finalResponse.length < text.length - 1300) {
                let _title = text.split("\n")[0];
                console.warn(`Response too short (${_title}) (${finalResponse.length} chars vs request ${text.length} chars). Starting new chat and retrying...`);
                retryCount++;
                if (retryCount >= maxRetries) {
                    throw new Error(`Response consistently too short after ${maxRetries} attempts`);
                }

                // Click "Create new chat" button
                await page.evaluate(() => {
                    const btn = document.querySelector('[data-testid="create-new-chat-button"]');
                    if (btn) btn.click();
                });
                // Wait for new chat to load
                await new Promise(r => setTimeout(r, 2000));

                // Submit system prompt (readme1.md) vào chat mới
                if (systemInstruction) {
                    const inputSel = '#prompt-textarea';
                    const stopSel = '[aria-label="Stop streaming"]';
                    await page.waitForSelector(inputSel, { timeout: 10000 });
                    await page.focus(inputSel);
                    await page.evaluate((selector, instruction) => {
                        const el = document.querySelector(selector);
                        if (el) {
                            const escapeHtml = (str) => str
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/"/g, '&quot;')
                                .replace(/'/g, '&#039;');
                            const lines = instruction.split('\n');
                            el.innerHTML = lines.map(l => `<p>${escapeHtml(l) || ''}</p>`).join('');
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }, inputSel, systemInstruction);
                    await page.type(inputSel, ' ');
                    await page.keyboard.press('Backspace');
                    await new Promise(r => setTimeout(r, 1000));
                    await page.keyboard.press('Enter');

                    // Đợi system prompt được xử lý xong
                    try {
                        await page.waitForSelector(stopSel, { visible: true, timeout: 5000 });
                        await page.waitForSelector(stopSel, { hidden: true, timeout: 60000 });
                        console.log('System prompt submitted to new chat. Retrying original request...');
                    } catch (e) {
                        console.warn('System prompt may have finished quickly:', e.message);
                    }
                }

                continue;
            }

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
    if (browsers.length === 0 || workers.length === 0) {
        return res.status(400).json({ error: "Browser windows not initialized. Call /init first." });
    }

    await new Promise((resolve) => {
        requestQueue.push({ req, res, resolve });
        processQueue();
    });
});

export default router;
