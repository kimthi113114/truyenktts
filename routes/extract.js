import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { URL } from "url";
import puppeteer from "puppeteer";
const router = express.Router();
import fs from "fs";


const COOKIE_FILE = "./metruyencv_cookies.json";


router.get("/loginMetruyen", async (req, res) => {
  loginMetruyen();
})
async function loginMetruyen() {
  const browser = await puppeteer.launch({
    headless: false, // 👀 bật trình duyệt lên để bạn thấy
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto("https://metruyencv.com/", { waitUntil: "networkidle2" });

  // 🔹 Mở menu
  await page.waitForSelector('button[data-x-bind="OpenModal(\'menu\')"]', { timeout: 1000 });
  await page.click('button[data-x-bind="OpenModal(\'menu\')"]');
  await new Promise(r => setTimeout(r, 1000));

  // 🔹 Mở modal đăng nhập
  await page.waitForSelector('button[data-x-bind="OpenModal(\'login\')"]');
  await page.click('button[data-x-bind="OpenModal(\'login\')"]');
  await page.waitForSelector('input[placeholder="email"]', { timeout: 1000 });

  // 🔹 Nhập tài khoản
  await page.type('input[placeholder="email"]', "kimthi113114@gmail.com", { delay: 50 });
  await page.type('input[placeholder="password"]', "anhkim123", { delay: 50 });

  // 🔹 Nhấn nút đăng nhập
  await page.click('button[data-x-bind="Submit"]');

  // Chờ đăng nhập thành công (avatar hiện ra)
  await page.waitForSelector('img[data-x-bind="UserAvatar($store.account.userData)"]', { timeout: 2000 });

  console.log("✅ Đăng nhập thành công!");

  // 🔹 Lưu cookie để lần sau không phải login lại
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));

  await browser.close();
}

const isDebug = false;

async function getChapterHTMLmetruyen(url) {
  const browser = await puppeteer.launch({
    headless: "shell", // ⚡ nhanh hơn hẳn engine cũ
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-default-apps",
      "--disable-gpu",
    ],
  });
  const page = await browser.newPage();
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE));
    for (const cookie of cookies) await page.setCookie(cookie);
  }

  // 🪄 Hook fillText để log tất cả lần vẽ chữ (kèm canvas ID + toạ độ)
  await page.evaluateOnNewDocument(() => {
    const fillCalls = [];
    const origFillText = CanvasRenderingContext2D.prototype.fillText;

    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
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
  if (isDebug)
    console.log("📜 Tổng số lần fillText:", calls.length);

  // 🧩 Gom theo canvas
  const grouped = {};
  for (const c of calls) {
    if (!grouped[c.id]) grouped[c.id] = [];
    grouped[c.id].push(c);
  }

  // 🧠 Log thông tin từng canvas trước khi xử lý
  for (const [id, arr] of Object.entries(grouped)) {
    if (isDebug)
      console.log(`\n🎨 Canvas ${id} (${arr.length} lần vẽ):`);
    arr.forEach(a => {
      if (isDebug)
        console.log(`  → "${a.text}" @ (${a.x}, ${a.y})`)
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

    const finalText = lines.join(" ").replace(/\s{2,}/g, " ").trim();
    grouped[id] = finalText;

    if (isDebug)
      console.log(`\n🧩 Canvas ${id} sau khi ghép:`);
    if (isDebug)
      console.log(finalText);
  }

  // 🔁 Thay canvas = text đã nối
  await page.evaluate(grouped => {
    document.querySelectorAll("#chapter-content canvas").forEach(c => {
      const id = c.dataset.cid;
      const text = grouped[id] || "";
      const span = document.createElement("span");
      span.textContent = text;
      span.style.whiteSpace = "pre-wrap";
      c.replaceWith(span);
    });
  }, grouped);

  // ✅ Lấy HTML cuối
  const html = await page.$eval("#chapter-content", el => el.outerHTML);

  await browser.close();
  return html;
}


async function reTryGetChapterHTMLmetruyen(url, retries = 5, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await getChapterHTMLmetruyen(url);
    } catch (error) {
      console.warn(`Thử lần ${i + 1} thất bại:`, error.message);
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
    }
  }
  console.error(`Không thể tải chapter sau ${retries} lần thử: ${url}`);
  return null;
}


// 🧠 Router chính
router.get("/extract", async (req, res) => {
  const url = (req.query.url || "").trim();
  if (!url) return res.status(400).json({ error: "Thiếu tham số url" });

  try {
    // --- Fetch HTML ban đầu ---
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (!resp.ok) {
      return res
        .status(resp.status)
        .json({ error: `Fetch thất bại: ${resp.status} ${resp.statusText}` });
    }

    const html = await resp.text();
    const $ = cheerio.load(html);

    // --- Nếu là trang metruyencv ---
    if (url.includes("metruyencv")) {
      let $root = $("#chapter-content").clone();
      let renderedHTML = await reTryGetChapterHTMLmetruyen(url);
      let $2 = cheerio.load(renderedHTML);
      $root = $2("#chapter-content").clone();

      // ✅ Làm sạch nội dung
      $root.find("script, style, noscript, iframe, canvas, #custom-ad-slot, [aria-hidden='true'], div[id^='middle-content']").remove();
      $root.find("br").replaceWith("\n");

      let rawText = $root.text();
      rawText = rawText.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();

      let text = rawText
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .join("\n\n");

      // 🧠 Nếu text rỗng → thử gọi lại một lần nữa
      if (!text || text.length === 0) {
        console.warn("⚠️ Text is empty, retrying fetch...");
        renderedHTML = await reTryGetChapterHTMLmetruyen(url);
        $2 = cheerio.load(renderedHTML);
        $root = $2("#chapter-content").clone();

        $root.find("script, style, noscript, iframe, canvas, #custom-ad-slot, [aria-hidden='true'], div[id^='middle-content']").remove();
        $root.find("br").replaceWith("\n");

        rawText = $root.text();
        rawText = rawText.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();

        text = rawText
          .split("\n")
          .map(line => line.trim())
          .filter(Boolean)
          .join("\n\n");
      }

      const chapterInfo = findChapterInfo($, url) || {};
      const chapterLine = buildChapterLine(chapterInfo.chapterNumber, chapterInfo.chapterTitle);

      console.log("chapterLine", chapterLine);
      return res.json({ url, text, length: text.length, ...chapterInfo, chapterLine });
    }


    // --- Các trang KHÁC: giữ nguyên logic gốc ---
    const $root = $("#content-chapter").clone();
    if ($root.length === 0)
      return res.status(404).json({ error: "Không tìm thấy #content-chapter" });

    $root.find("script,style,noscript,iframe,#custom-ad-slot,[aria-hidden='true']").remove();

    const text = $root
      .find("p")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join("\n\n");

    const chapterInfo = findChapterInfo($, url) || {};
    const chapterLine = buildChapterLine(chapterInfo.chapterNumber, chapterInfo.chapterTitle);
    console.log(chapterInfo);

    res.json({ url, text, length: text.length, ...chapterInfo, chapterLine });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

export default router;


export function resolveHref(href, baseUrl) {
  try { return new URL(href, baseUrl).href; } catch { return href; }
}

export function parseChapterLine(str = "") {
  const s = str.trim();
  const patterns = [
    /Chương\s*(\d+)\s*[:：\-–—]\s*(.+)$/i,
    /-\s*Chương\s*(\d+)\s*[:：\-–—]\s*(.+)$/i,
    /Chương\s*(\d+)\s+(.+)$/i
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
    'h2:contains("Chương")'
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
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.goto("https://copilot.microsoft.com", { waitUntil: "networkidle2" });

  console.log("🌐 Đã mở trang Copilot.");

  // 🔹 Nhấn nút "Sign in" (hoặc “Đăng nhập”)
  await page.waitForSelector('a[href*="login.microsoftonline.com"]', { timeout: 5000 });
  await page.click('a[href*="login.microsoftonline.com"]');

  // 🔹 Đợi trang Microsoft Login xuất hiện
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  console.log("✉️ Nhập email Microsoft...");
  await page.type('input[type="email"]', "your_email@outlook.com", { delay: 50 });
  await page.keyboard.press("Enter");

  // 🔹 Chờ chuyển sang nhập mật khẩu
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  console.log("🔑 Nhập mật khẩu...");
  await page.type('input[type="password"]', "your_password_here", { delay: 50 });
  await page.keyboard.press("Enter");

  // 🔹 Có thể xuất hiện màn hình “Stay signed in?”
  try {
    await page.waitForSelector('input[type="submit"][value="Yes"], input[type="submit"][value="Có"]', { timeout: 8000 });
    await page.click('input[type="submit"][value="Yes"], input[type="submit"][value="Có"]');
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

  await browser.close();
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
