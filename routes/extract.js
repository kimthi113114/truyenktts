import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { URL } from "url";
import fs from "fs";
import browserManager from "../utils/browserManager.js";
const router = express.Router();

const COOKIE_FILE = "./metruyencv_cookies.json";

router.get("/loginMetruyen", async (req, res) => {
    loginMetruyen();
});
async function loginMetruyen() {
    const page = await browserManager.newPage();
    await page.goto("https://metruyencv.com/", { waitUntil: "networkidle2" });

    // 🔹 Mở menu
    await page.waitForSelector("button[data-x-bind=\"OpenModal('menu')\"]", {
        timeout: 1000,
    });
    await page.click("button[data-x-bind=\"OpenModal('menu')\"]");
    await new Promise((r) => setTimeout(r, 1000));

    // 🔹 Mở modal đăng nhập
    await page.waitForSelector("button[data-x-bind=\"OpenModal('login')\"]");
    await page.click("button[data-x-bind=\"OpenModal('login')\"]");
    await page.waitForSelector('input[placeholder="email"]', { timeout: 1000 });

    // 🔹 Nhập tài khoản
    await page.type('input[placeholder="email"]', "kimthi113114@gmail.com", {
        delay: 50,
    });
    await page.type('input[placeholder="password"]', "anhkim123", { delay: 50 });

    // 🔹 Nhấn nút đăng nhập
    await page.click('button[data-x-bind="Submit"]');

    // Chờ đăng nhập thành công (avatar hiện ra)
    await page.waitForSelector(
        'img[data-x-bind="UserAvatar($store.account.userData)"]',
        { timeout: 2000 },
    );

    console.log("✅ Đăng nhập thành công!");

    // 🔹 Lưu cookie để lần sau không phải login lại
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));

    await browser.close();
}

const isDebug = false;

async function getChapterHTMLmetruyen(url) {
    const page = await browserManager.newPage();
    if (fs.existsSync(COOKIE_FILE)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE));
        for (const cookie of cookies) await page.setCookie(cookie);
    }

    // 🪄 Hook fillText để log tất cả lần vẽ chữ (kèm canvas ID + toạ độ)
    await page.evaluateOnNewDocument(() => {
        const fillCalls = [];
        const origFillText = CanvasRenderingContext2D.prototype.fillText;

        CanvasRenderingContext2D.prototype.fillText = function (
            text,
            x,
            y,
            ...rest
        ) {
            const id = this.canvas ? this.canvas.dataset.cid : "none";
            fillCalls.push({ id, text, x, y });
            return origFillText.call(this, text, x, y, ...rest);
        };

        const origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (...args) {
            if (!this.dataset.cid)
                this.dataset.cid = "c" + Math.random().toString(36).slice(2, 8);
            return origGetContext.apply(this, args);
        };

        window.__fillCalls = fillCalls;
    });

    // ⏳ Load trang
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector("#chapter-content");

    // 🧾 Lấy tất cả lệnh fillText được gọi
    const calls = await page.evaluate(() => window.__fillCalls);
    if (isDebug) console.log("📜 Tổng số lần fillText:", calls.length);

    // 🧩 Gom theo canvas
    const grouped = {};
    for (const c of calls) {
        if (!grouped[c.id]) grouped[c.id] = [];
        grouped[c.id].push(c);
    }

    // 🧠 Log thông tin từng canvas trước khi xử lý
    for (const [id, arr] of Object.entries(grouped)) {
        if (isDebug) console.log(`\n🎨 Canvas ${id} (${arr.length} lần vẽ):`);
        arr.forEach((a) => {
            if (isDebug) console.log(`  → "${a.text}" @ (${a.x}, ${a.y})`);
        });
    }

    // 🔍 Mỗi canvas: sắp xếp theo Y rồi nối thành từng dòng
    for (const id in grouped) {
        const arr = grouped[id].sort((a, b) => a.y - b.y || a.x - b.x);

        let lines = [];
        let currentLine = [];
        let lastY = arr[0]?.y ?? 0;

        for (const { text, y } of arr) {
            // nếu chênh lệch Y > 10 pixel, coi là xuống dòng
            if (Math.abs(y - lastY) > 10) {
                lines.push(currentLine.join(" "));
                currentLine = [];
            }
            currentLine.push(text);
            lastY = y;
        }
        if (currentLine.length) lines.push(currentLine.join(" "));

        const finalText = lines
            .join(" ")
            .replace(/\s{2,}/g, " ")
            .trim();
        grouped[id] = finalText;

        if (isDebug) console.log(`\n🧩 Canvas ${id} sau khi ghép:`);
        if (isDebug) console.log(finalText);
    }

    // 🔁 Thay canvas = text đã nối
    await page.evaluate((grouped) => {
        document.querySelectorAll("#chapter-content canvas").forEach((c) => {
            const id = c.dataset.cid;
            const text = grouped[id] || "";
            const span = document.createElement("span");
            span.textContent = text;
            span.style.whiteSpace = "pre-wrap";
            c.replaceWith(span);
        });
    }, grouped);

    // ✅ Lấy HTML cuối
    const html = await page.$eval("#chapter-content", (el) => el.outerHTML);

    await page.close();
    return html;
}

async function reTryGetChapterHTMLmetruyen(url, retries = 5, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await getChapterHTMLmetruyen(url);
        } catch (error) {
            console.warn(`Thử lần ${i + 1} thất bại:`, error.message);
            if (i < retries - 1) await new Promise((r) => setTimeout(r, delay));
        }
    }
    console.error(`Không thể tải chapter sau ${retries} lần thử: ${url}`);
    return null;
}

async function getChapterHTMLtruyenss(url) {
    console.log(`🚀 Rendering truyenss: ${url}`);
    const page = await browserManager.newPage();
    try {
        page.on("console", (msg) => console.log("BROWSER:", msg.text()));

        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

        // Đợi một chút để script page chạy (đặc biệt là xử lý hash)
        await new Promise((r) => setTimeout(r, 5000));

        // Đợi container xuất hiện
        try {
            await page.waitForSelector(".xem-chuong", { timeout: 20000 });
        } catch (e) {
            console.warn(
                "⚠️ .xem-chuong not found, trying again with a longer wait...",
            );
            await new Promise((r) => setTimeout(r, 10000));
            const htmlSnippet = await page.evaluate(() =>
                document.body.innerHTML.substring(0, 1000),
            );
            console.log(`📄 HTML Snippet: ${htmlSnippet}`);
            await page.waitForSelector(".xem-chuong", { timeout: 5000 });
        }

        // Đợi content bên trong (p) xuất hiện
        await page
            .waitForSelector(".xem-chuong p", { timeout: 15000 })
            .catch(() => {
                console.log("⚠️ timeout waiting for .xem-chuong p");
            });

        const html = await page.$eval(".xem-chuong", (el) => el.outerHTML);
        return html;
    } catch (err) {
        console.error(`❌ Error rendering truyenss: ${err.message}`);
        throw err;
    } finally {
        await page.close();
    }
}

async function getChapterHTMLxalosach(url) {
    url = url + ".html";
    console.log(`🚀 Rendering xalosach: ${url}`);
    const page = await browserManager.newPage();
    try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

        // Đợi container lst_content xuất hiện
        await page.waitForSelector("#lst_content", { timeout: 20000 });

        // Lấy HTML của element chứa nội dung
        const html = await page.$eval("#content_chap", (el) => el.outerHTML);
        return html;
    } catch (err) {
        console.error(`❌ Error rendering xalosach: ${err.message}`);
        throw err;
    } finally {
        await page.close();
    }
}

async function reTryGetChapterHTMLxalosach(url, retries = 3, delay = 1000) {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
        try {
            return await getChapterHTMLxalosach(url);
        } catch (error) {
            lastError = error;
            console.warn(`Thử lần ${i + 1} thất bại (xalosach):`, error.message);
            if (i < retries - 1) await new Promise((r) => setTimeout(r, delay));
        }
    }
    return { error: lastError?.message || "Unknown error" };
}

// --- 123truyen.vn: Manual cookie bypass ---
const COOKIE_FILE_123TRUYEN = "./cookies/123truyen.json";

// Lưu cookie string + user-agent từ Chrome thật
function save123truyenConfig(cookieStr, userAgent) {
    fs.mkdirSync("./cookies", { recursive: true });
    fs.writeFileSync(
        COOKIE_FILE_123TRUYEN,
        JSON.stringify({ cookie: cookieStr, userAgent }, null, 2),
    );
    console.log(`✅ Đã lưu cookie + user-agent cho 123truyen.vn`);
}

// Load saved config
function get123truyenConfig() {
    if (!fs.existsSync(COOKIE_FILE_123TRUYEN)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(COOKIE_FILE_123TRUYEN, "utf-8"));
        if (!data.cookie) return null;
        return data;
    } catch {
        return null;
    }
}

async function getChapterHTML123truyen(url) {
    console.log(`🚀 Fetching 123truyen: ${url}`);

    const config = get123truyenConfig();
    if (!config) {
        throw new Error(
            "Chưa có cookies! Mở http://localhost:3001/setCookie123truyen.html để nhập cookie.",
        );
    }

    const resp = await fetch(url, {
        headers: {
            "User-Agent": config.userAgent,
            Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
            Connection: "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            Cookie: config.cookie,
        },
    });
    if (!resp.ok) {
        throw new Error(
            `Fetch thất bại: ${resp.status} ${resp.statusText}. Nhập lại cookie tại /setCookie123truyen.html`,
        );
    }
    const html = await resp.text();
    if (
        html.includes("security verification") ||
        html.includes("Performing security") ||
        html.includes("Just a moment")
    ) {
        throw new Error(
            "Cloudflare chặn. Cookie hết hạn, nhập lại tại /setCookie123truyen.html",
        );
    }
    return html;
}

async function reTryGetChapterHTML123truyen(url, retries = 3, delay = 2000) {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
        try {
            return await getChapterHTML123truyen(url);
        } catch (error) {
            lastError = error;
            console.warn(`Thử lần ${i + 1} thất bại (123truyen):`, error.message);
            if (i < retries - 1) await new Promise((r) => setTimeout(r, delay));
        }
    }
    return { error: lastError?.message || "Unknown error" };
}

async function reTryGetChapterHTMLtruyenss(url, retries = 3, delay = 1000) {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
        try {
            return await getChapterHTMLtruyenss(url);
        } catch (error) {
            lastError = error;
            console.warn(`Thử lần ${i + 1} thất bại (truyenss):`, error.message);
            if (i < retries - 1) await new Promise((r) => setTimeout(r, delay));
        }
    }
    return { error: lastError?.message || "Unknown error" };
}

// --- Router chính ---
router.get("/extract", async (req, res) => {
    const url = (req.query.url || "").trim();
    if (!url) return res.status(400).json({ error: "Thiếu tham số url" });

    try {
        let html;
        let $;

        // --- Chiến lược cào: Puppeteer cho các trang động, Fetch cho các trang tĩnh ---
        if (url.includes("metruyencv.com")) {
            html = await reTryGetChapterHTMLmetruyen(url);
        } else if (url.includes("truyenss.com")) {
            const rendered = await reTryGetChapterHTMLtruyenss(url);
            if (rendered.error)
                return res.status(500).json({
                    error: `Không thể render trang truyenss.com: ${rendered.error}`,
                });
            html = rendered;
        } else if (url.includes("xalosach.com")) {
            const rendered = await reTryGetChapterHTMLxalosach(url);
            if (rendered.error)
                return res.status(500).json({
                    error: `Không thể render trang xalosach.com: ${rendered.error}`,
                });
            html = rendered;
        } else if (url.includes("123truyen.vn")) {
            html = await reTryGetChapterHTML123truyen(url);
            if (html?.error)
                return res
                    .status(500)
                    .json({ error: `Không thể lấy trang 123truyen.vn: ${html.error}` });
        } else {
            // Các trang khác dùng fetch cho nhanh
            const resp = await fetch(url, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            });
            if (!resp.ok) {
                return res
                    .status(resp.status)
                    .json({ error: `Fetch thất bại: ${resp.status} ${resp.statusText}` });
            }
            html = await resp.text();
        }

        if (!html)
            return res.status(404).json({ error: "Không thể lấy nội dung HTML" });
        $ = cheerio.load(html);

        let text = "";
        let chapterInfo = {};

        if (url.includes("metruyencv.com")) {
            const $root = $("#chapter-content").clone();
            $root
                .find(
                    "script, style, noscript, iframe, canvas, #custom-ad-slot, [aria-hidden='true'], div[id^='middle-content']",
                )
                .remove();
            $root.find("br").replaceWith("\n");
            let rawText = $root.text();
            rawText = rawText
                .replace(/\r/g, "")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
            text = rawText
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .join("\n\n");
            chapterInfo = findChapterInfo($, url) || {};
        } else if (url.includes("truyenss.com")) {
            const $root = $(".xem-chuong");
            const chapterTitleRaw =
                $root.find("p b").first().text().trim() ||
                $root.find("p").first().text().trim();
            chapterInfo = parseChapterLine(chapterTitleRaw) || {};

            $root.find("h1, script, style, noscript, iframe, .text-center").remove();
            const paragraphs = $root.find("p");
            if (paragraphs.length > 0) {
                const firstP = paragraphs.first();
                if (
                    firstP.find("b").length > 0 ||
                    /Chương\s*\d+/i.test(firstP.text())
                ) {
                    firstP.remove();
                }
            }
            text = $root
                .find("p")
                .map((_, el) => $(el).text().trim())
                .get()
                .filter(Boolean)
                .join("\n\n");
        } else if (url.includes("xalosach.com")) {
            const $root = $("#lst_content");

            // Xử lý tiêu đề chương từ dòng đầu tiên nếu có
            const firstLine = $root.contents().first().text().trim();
            if (/Chương\s*\d+/i.test(firstLine)) {
                chapterInfo = parseChapterLine(firstLine) || {};
            }

            // Clone để tránh ảnh hưởng DOM gốc nếu cần
            const $content = $root.clone();

            // Loại bỏ các element không cần thiết (script, style, etc.)
            $content
                .find("script, style, noscript, iframe, .ads, .advertisement")
                .remove();

            // Thay <br> bằng \n để giữ cấu trúc xuống dòng
            $content.find("br").replaceWith("\n");

            let rawText = $content.text();

            // Làm sạch text
            text = rawText
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => {
                    // Bỏ dòng tiêu đề chương nếu đã parse được
                    if (
                        chapterInfo.chapterNumber &&
                        line.includes(`Chương ${chapterInfo.chapterNumber}`)
                    ) {
                        return false;
                    }
                    return line.length > 0;
                })
                .join("\n\n");

            if (!chapterInfo.chapterNumber) {
                chapterInfo = findChapterInfo($, url) || {};
            }
        } else if (
            url.includes("123truyen.vn") ||
            url.includes("truyenmoiyy.com")
        ) {
            const $root = $(".chapter-content");

            // Clone để tránh ảnh hưởng DOM gốc
            const $content = $root.clone();

            // Loại bỏ 3 thẻ p cuối cùng theo yêu cầu
            const allP = $content.find("p");
            if (allP.length >= 3) {
                allP.slice(-3).remove();
            }

            // Loại bỏ các element không cần thiết (script, style, iframe, etc.)
            $content
                .find("script, style, noscript, iframe, .ads, .advertisement")
                .remove();

            // Xử lý tiêu đề chương từ dòng đầu tiên nếu có
            const firstLine = $content.contents().first().text().trim();
            if (/Chương\s*\d+/i.test(firstLine)) {
                chapterInfo = parseChapterLine(firstLine) || {};
            }

            // Thay <br> bằng \n
            $content.find("br").replaceWith("\n");

            let rawText = $content.text();

            // Làm sạch text
            text = rawText
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => {
                    // Bỏ dòng tiêu đề chương nếu đã parse được
                    if (
                        chapterInfo.chapterNumber &&
                        line.includes(`Chương ${chapterInfo.chapterNumber}`)
                    ) {
                        return false;
                    }
                    // Bỏ các dòng link Fanpage
                    if (line.includes("Click Theo Dõi -> Fanpage")) return false;
                    return line.length > 0;
                })
                .join("\n\n");
            if (url.includes("truyenmoiyy.com")) {
                let lines = text.split("\n\n");
                lines.pop(); // bỏ phần tử cuối cùng
                text = lines.join("\n\n");
            }
            if (!chapterInfo.chapterNumber) {
                chapterInfo = findChapterInfo($, url) || {};
            }
        } else {
            // Mặc định cho các trang khác
            const $root = $("#content-chapter").length
                ? $("#content-chapter").clone()
                : $("body").clone();
            $root
                .find(
                    "script,style,noscript,iframe,#custom-ad-slot,[aria-hidden='true']",
                )
                .remove();

            const pTags = $root.find("p");
            if (pTags.length > 5) {
                text = pTags
                    .map((_, el) => $(el).text().trim())
                    .get()
                    .filter(Boolean)
                    .join("\n\n");
            } else {
                text = $root.text().replace(/\s+/g, " ").trim();
            }
            chapterInfo = findChapterInfo($, url) || {};
        }

        const chapterLine = buildChapterLine(
            chapterInfo.chapterNumber,
            chapterInfo.chapterTitle,
        );
        res.json({ url, text, length: text.length, ...chapterInfo, chapterLine });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server error", detail: String(e) });
    }
});

export default router;

router.post("/setCookie123truyen", (req, res) => {
    const { cookie, userAgent } = req.body || {};
    if (!cookie || !userAgent) {
        return res.status(400).json({ error: "Cần cả 'cookie' và 'userAgent'" });
    }
    save123truyenConfig(cookie, userAgent);
    res.json({
        success: true,
        message: "✅ Đã lưu cookie + user-agent cho 123truyen.vn!",
    });
});

export function resolveHref(href, baseUrl) {
    try {
        return new URL(href, baseUrl).href;
    } catch {
        return href;
    }
}

export function parseChapterLine(str = "") {
    const s = str.trim();
    const patterns = [
        /Chương\s*(\d+)\s*[:：\-–—]\s*(.+)$/i,
        /-\s*Chương\s*(\d+)\s*[:：\-–—]\s*(.+)$/i,
        /Chương\s*(\d+)\s+(.+)$/i,
    ];
    for (const re of patterns) {
        const m = s.match(re);
        if (m) return { chapterNumber: m[1], chapterTitle: (m[2] || "").trim() };
    }
    return null;
}

export function buildChapterLine(num = "", title = "") {
    if (!num && !title) return "";
    return `Chương ${num}${title ? `: ${title}` : ""}`;
}

export function findChapterInfo($, baseUrl) {
    const scopes = [
        "#content-chapter a[title]",
        "#content-chapter a",
        'a[title*="Chương"]',
        'a:contains("Chương")',
        'h1:contains("Chương")',
        'h2:contains("Chương")',
    ];

    for (const sel of scopes) {
        const $candidates = $(sel);
        for (const el of $candidates.toArray()) {
            const $a = $(el);
            const titleAttr = $a.attr("title")?.trim() || "";
            const text = $a.text()?.trim() || "";
            const href = resolveHref($a.attr("href") || "", baseUrl);

            let parsed = null;
            if (/Chương/i.test(titleAttr)) parsed = parseChapterLine(titleAttr);
            if (!parsed && /Chương/i.test(text)) parsed = parseChapterLine(text);
            if (parsed) return { ...parsed, chapterHref: href };
        }
    }

    const pageTitle = ($("title").text() || "").trim();
    if (/Chương/i.test(pageTitle)) {
        const parsed = parseChapterLine(pageTitle);
        if (parsed) return { ...parsed, chapterHref: baseUrl };
    }
    return null;
}

const COOKIE_FILE2 = "./cookies/copilot.cookies.json";

export async function loginCopilot() {
    const page = await browserManager.newPage();
    await page.goto("https://copilot.microsoft.com", {
        waitUntil: "networkidle2",
    });

    console.log("🌐 Đã mở trang Copilot.");

    // 🔹 Nhấn nút "Sign in" (hoặc “Đăng nhập”)
    await page.waitForSelector('a[href*="login.microsoftonline.com"]', {
        timeout: 5000,
    });
    await page.click('a[href*="login.microsoftonline.com"]');

    // 🔹 Đợi trang Microsoft Login xuất hiện
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    console.log("✉️ Nhập email Microsoft...");
    await page.type('input[type="email"]', "your_email@outlook.com", {
        delay: 50,
    });
    await page.keyboard.press("Enter");

    // 🔹 Chờ chuyển sang nhập mật khẩu
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    console.log("🔑 Nhập mật khẩu...");
    await page.type('input[type="password"]', "your_password_here", {
        delay: 50,
    });
    await page.keyboard.press("Enter");

    // 🔹 Có thể xuất hiện màn hình “Stay signed in?”
    try {
        await page.waitForSelector(
            'input[type="submit"][value="Yes"], input[type="submit"][value="Có"]',
            { timeout: 8000 },
        );
        await page.click(
            'input[type="submit"][value="Yes"], input[type="submit"][value="Có"]',
        );
    } catch {
        console.log("⏩ Không thấy màn hình 'Stay signed in?', bỏ qua.");
    }

    // 🔹 Quay lại trang Copilot
    await page.waitForNavigation({ waitUntil: "networkidle2" });
    console.log("✅ Đăng nhập Copilot thành công!");

    // 🔹 Lưu cookie lại
    const cookies = await page.cookies();
    fs.mkdirSync("./cookies", { recursive: true });
    fs.writeFileSync(COOKIE_FILE2, JSON.stringify(cookies, null, 2));

    console.log("💾 Đã lưu cookie vào:", COOKIE_FILE2);

    await page.close();
}

router.get("/loginCopilot", async (req, res) => {
    try {
        await loginCopilot();
        res.send("✅ Đăng nhập Copilot thành công!");
    } catch (err) {
        console.error(err);
        res.status(500).send("❌ Lỗi đăng nhập Copilot");
    }
});
