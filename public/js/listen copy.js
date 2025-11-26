let currentChapters = {}, currentChapterId = null, isPlaying = false, currentAudio = null, currentStoryId = null;
let sleepTimer = null;
let sleepTimerInterval = null; // For countdown display
let stopAtEndOfChapter = false;
const toastEl = document.getElementById("toast");
let isAutoScrollEnabled = true; // Default enabled

// Global Audio Cache for cross-chapter preloading
const audioCache = new Map(); // Key: `${chapterId}_${index}`, Value: blobUrl
let cachedNextChapterId = null;
let cachedNextSentences = [];
let playbackSessionId = 0;

// URL Management
function getStoryIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('story');
}

function updateURL(storyId) {
    const newURL = storyId ? `?story=${encodeURIComponent(storyId)}` : window.location.pathname;
    window.history.pushState({ storyId }, '', newURL);
}

// Storage Management (LocalStorage for better performance)
function setStorage(name, value) {
    try {
        localStorage.setItem(name, value);
    } catch (e) {
        console.warn("LocalStorage failed:", e);
    }
}

function getStorage(name) {
    return localStorage.getItem(name);
}



let saveProgressTimeout = null;

function saveProgress(sentenceIndex = 0, immediate = false) {
    if (!currentStoryId || !currentChapterId) return;

    const doSave = () => {
        let allProgress = {};
        try {
            const stored = getStorage('readingProgress');
            if (stored) {
                allProgress = JSON.parse(stored);
                // Migration check: if old format (has .storyId at root), reset or convert
                if (allProgress.storyId) {
                    const old = allProgress;
                    allProgress = {};
                    if (old.storyId) allProgress[old.storyId] = old;
                }
            }
        } catch (e) { console.warn("Progress parse error", e); }

        allProgress[currentStoryId] = {
            chapterId: currentChapterId,
            sentenceIndex: sentenceIndex,
            timestamp: Date.now()
        };
        setStorage('readingProgress', JSON.stringify(allProgress));
        // console.log("Progress saved (debounced)");
    };

    if (immediate) {
        if (saveProgressTimeout) clearTimeout(saveProgressTimeout);
        doSave();
    } else {
        if (saveProgressTimeout) clearTimeout(saveProgressTimeout);
        saveProgressTimeout = setTimeout(doSave, 5000); // Save every 5 seconds max
    }
}

function getSavedSentenceIndex() {
    const progressStr = getStorage('readingProgress');
    if (!progressStr) return 0;

    try {
        const allProgress = JSON.parse(progressStr);
        // Handle both new map format and potential old format migration
        const progress = allProgress[currentStoryId] || (allProgress.storyId === currentStoryId ? allProgress : null);

        if (progress && progress.chapterId === currentChapterId) {
            return progress.sentenceIndex || 0;
        }
    } catch (err) {
        console.error("Error getting sentence index:", err);
    }
    return 0;
}

async function loadProgress() {
    const progressStr = getStorage('readingProgress');
    if (!progressStr) return;

    try {
        let allProgress = JSON.parse(progressStr);
        // Migration
        if (allProgress.storyId) {
            const old = allProgress;
            allProgress = {};
            allProgress[old.storyId] = old;
        }

        // Find most recent
        let mostRecent = null;
        Object.keys(allProgress).forEach(key => {
            const p = allProgress[key];
            if (!mostRecent || p.timestamp > mostRecent.timestamp) {
                mostRecent = { ...p, storyId: key };
            }
        });

        if (!mostRecent) return;

        const select = document.getElementById('storySelect');
        select.value = mostRecent.storyId;
        await loadStory(mostRecent.storyId);
        await new Promise(r => setTimeout(r, 500));

        if (currentChapters[mostRecent.chapterId]) {
            loadChapter(mostRecent.chapterId, true);
            setTimeout(() => {
                const sentences = document.querySelectorAll('.sentence');
                if (sentences[mostRecent.sentenceIndex]) {
                    sentences[mostRecent.sentenceIndex].scrollIntoView({ behavior: 'auto', block: 'center' });
                    sentences[mostRecent.sentenceIndex].style.backgroundColor = '#dbeafe';
                    setTimeout(() => sentences[mostRecent.sentenceIndex].style.backgroundColor = '', 3000);
                }
            }, 300);
            showToast("Đã khôi phục tiến trình đọc!", "success");
        }
    } catch (err) {
        console.error("Error loading progress:", err);
    }
}

function showToast(message, type = 'success') {
    const toastIcon = toastEl.querySelector('.toast-icon');
    const toastMessage = toastEl.querySelector('.toast-message');
    toastMessage.textContent = message;
    toastEl.className = `toast ${type}`;
    toastIcon.textContent = type === 'success' ? '✅' : (type === 'error' ? '❌' : '⚠️');
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 1500);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth <= 768) sidebar.classList.toggle('open');
    else sidebar.classList.toggle('collapsed');
}

function toggleTTSControls() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) {
        toggleSidebar();
        return;
    }
    const controls = document.getElementById('ttsControls');
    const toggle = document.getElementById('ttsToggle');
    if (controls.classList.contains('collapsed'))
        controls.classList.remove('collapsed');
    else {
        controls.classList.add('collapsed');
        if (toggle?.style?.display) {
            toggle.style.display = 'flex';
        }

    }
}

async function init() {
    try { loadSettings(); } catch (e) { console.error("Settings load failed:", e); }
    try {
        const resp = await fetch('/api/stories-listen');
        const stories = await resp.json();
        const select = document.getElementById('storySelect');
        stories.forEach(story => {
            const option = document.createElement('option');
            option.value = story.id;
            option.textContent = story.title;
            select.appendChild(option);
        });

        const urlStoryId = getStoryIdFromURL();
        const progressStr = getStorage('readingProgress');

        if (urlStoryId) {
            select.value = urlStoryId;
            await loadStory(urlStoryId);

            if (progressStr) {
                try {
                    let allProgress = JSON.parse(progressStr);
                    // Migration
                    if (allProgress.storyId) {
                        allProgress = { [allProgress.storyId]: allProgress };
                    }

                    const progress = allProgress[urlStoryId];

                    if (progress && currentChapters[progress.chapterId]) {
                        loadChapter(progress.chapterId, true);
                        setTimeout(() => {
                            const sentences = document.querySelectorAll('.sentence');
                            if (sentences[progress.sentenceIndex]) {
                                sentences[progress.sentenceIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                                sentences[progress.sentenceIndex].style.backgroundColor = '#dbeafe';
                                setTimeout(() => sentences[progress.sentenceIndex].style.backgroundColor = '', 3000);
                            }
                        }, 300);
                        showToast("Đã khôi phục tiến trình đọc!", "success");
                    }
                } catch (err) {
                    console.error("Error loading progress:", err);
                }
            }
        } else {
            await loadProgress();
        }
    } catch (err) {
        console.error(err);
        showToast("Không thể tải danh sách truyện", "error");
    }
}

async function onStoryChange(storyId) {
    await stopPlaying();
    updateURL(storyId);
    loadStory(storyId);
}
async function stopPlaying() {
    const btn = document.getElementById("speakBtn");
    if (btn?.textContent?.includes("Dừng")) {
        await startLiveTTS();
        return;
    }
}

function extractChapters(text) {
    const chapters = {};
    const standardizedText = '\n' + (text || '').trim() + '\n';
    const chapterRegex = /\n===\s*Chương\s*(\d+)(?::\s*(.*?))?\s*===\s*([\s\S]*?)(?=\n===\s*Chương|$)/gi;
    let m;
    while ((m = chapterRegex.exec(standardizedText)) !== null) {
        const num = parseInt(m[1], 10);
        const title = (m[2] || '').trim();
        const content = (m[3] || '').trim();
        if (!Number.isNaN(num)) chapters[num] = { title, content };
    }
    return chapters;
}

async function loadStory(storyId) {
    if (!storyId) return;
    currentStoryId = storyId;
    // Clear audio cache when switching stories
    audioCache.forEach(url => URL.revokeObjectURL(url));
    audioCache.clear();
    cachedNextChapterId = null;
    cachedNextSentences = [];

    showToast("Đang tải truyện...", "warning");
    document.getElementById('chapterList').innerHTML = '<div style="text-align:center;padding:20px">⏳ Đang tải...</div>';

    try {
        const resp = await fetch(`/api/story-content/${storyId}`);
        if (!resp.ok) throw new Error("Lỗi tải truyện");
        const data = await resp.json();
        currentChapters = extractChapters(data.content);
        renderChapterList();
        showToast("Đã tải xong truyện!", "success");
    } catch (err) {
        console.error(err);
        showToast("Lỗi: " + err.message, "error");
        document.getElementById('chapterList').innerHTML = '<div style="text-align:center;padding:20px;color:red">Lỗi tải dữ liệu</div>';
    }
}

function renderChapterList() {
    const listEl = document.getElementById('chapterList');
    listEl.innerHTML = '';
    const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
    if (sortedNums.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:20px">Không tìm thấy chương nào</div>';
        return;
    }
    sortedNums.forEach(num => {
        const ch = currentChapters[num];
        const item = document.createElement('div');
        item.className = 'chapter-item';
        item.textContent = `Chương ${num}: ${ch.title}`;
        item.onclick = () => {
            // Reset cache as requested for manual switch
            audioCache.forEach(url => URL.revokeObjectURL(url));
            audioCache.clear();
            loadChapter(num, false);
        };
        item.dataset.num = num;
        listEl.appendChild(item);
    });
}

function loadChapter(num, fromRestore = false) {
    currentChapterId = num;
    // Smart cleanup: Keep current and next chapter, remove others
    if (window.preloadBuffer) {
        const nextId = getNextChapterId(num);
        for (const key of window.preloadBuffer.keys()) {
            const parts = key.split('_');
            if (parts.length === 2) {
                const chId = parseInt(parts[0]);
                if (chId !== num && (nextId === null || chId !== nextId)) {
                    window.preloadBuffer.get(key).then(url => { if (url) URL.revokeObjectURL(url); });
                    window.preloadBuffer.delete(key);
                }
            }
        }
    }
    const ch = currentChapters[num];
    document.getElementById('currentChapterTitle').textContent = `Chương ${num}: ${ch.title}`;
    const readingArea = document.getElementById('readingArea');

    let globalSentenceIndex = 0;
    // Add 'sentence' class to title so it gets read first
    const titleHtml = `<h1 class="sentence" data-index="${globalSentenceIndex++}">Chương ${num}: ${ch.title}</h1>`;

    const paragraphs = ch.content.split('\n').filter(p => p.trim()).map(p => {
        return `<p><span class="sentence" data-index="${globalSentenceIndex++}">${p.trim()}</span></p>`;
    }).join('');

    readingArea.innerHTML = titleHtml + paragraphs + `<div class="playback-controls">
        <button class="nav-btn chapter-nav-btn" onclick="prevChapter(event)">Chương Trước</button>
        <button class="nav-btn chapter-nav-btn" onclick="nextChapter(event)">Chương Sau</button>
        </div>`;

    // Optimize chapter item active state management
    document.querySelectorAll('.chapter-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.querySelector(`.chapter-item[data-num="${num}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
        // Only scroll if not in viewport - auto behavior for performance
        const rect = activeItem.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
            setTimeout(() => {
                activeItem.scrollIntoView({ behavior: 'auto', block: 'center' });
            }, 100);
        }
    }

    document.getElementById('status').textContent = '';
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    readingArea.scrollTop = 0;

    if (!fromRestore) {
        saveProgress(0, true); // Immediate save on chapter load
    }
    updateMediaSession();
}

function prevChapter(event) {
    if (event)
        event?.stopPropagation();
    if (!currentChapterId) return;
    const wasPlaying = isPlaying;
    if (wasPlaying) {
        isPlaying = false;
        audioPlayer.pause();
        document.querySelectorAll('.sentence.playing').forEach(el => el.classList.remove('playing'));
        document.getElementById('speakBtn').innerHTML = '<span>🔊</span> Đọc Ngay';
        document.getElementById('status').textContent = '';
    }

    const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
    const currentIndex = sortedNums.indexOf(currentChapterId);
    if (currentIndex > 0) {
        loadChapter(sortedNums[currentIndex - 1], false);
        if (wasPlaying) {
            showToast("Tự động tiếp tục phát...", "success");
            startLiveTTS();
        }
    } else {
        showToast("Đây là chương đầu tiên!", "warning");
    }
}

function nextChapter(event) {
    if (event)
        event?.stopPropagation();
    if (!currentChapterId) return;
    const wasPlaying = isPlaying;
    if (wasPlaying) {
        isPlaying = false;
        audioPlayer.pause();
        document.querySelectorAll('.sentence.playing').forEach(el => el.classList.remove('playing'));
        document.getElementById('speakBtn').innerHTML = '<span>🔊</span> Đọc Ngay';
        document.getElementById('status').textContent = '';
    }

    const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
    const currentIndex = sortedNums.indexOf(currentChapterId);
    if (currentIndex < sortedNums.length - 1) {
        loadChapter(sortedNums[currentIndex + 1], false);
        if (wasPlaying) {
            showToast("Tự động tiếp tục phát...", "success");
            startLiveTTS();
        }
        return true;
    } else {
        showToast("Đây là chương cuối cùng!", "warning");
        return false;
    }
}

// Media Session API for background playback (Safari support)
function updateMediaSession() {
    if ('mediaSession' in navigator && currentChapterId) {
        const ch = currentChapters[currentChapterId];
        const storyTitle = document.getElementById('storySelect').selectedOptions[0]?.textContent || 'Truyện';

        navigator.mediaSession.metadata = new MediaMetadata({
            title: `Chương ${currentChapterId}: ${ch.title}`,
            artist: storyTitle,
            album: 'Text-to-Speech'
        });

        navigator.mediaSession.setActionHandler('play', () => {
            if (!isPlaying) startLiveTTS();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            if (isPlaying) startLiveTTS();
        });

        navigator.mediaSession.setActionHandler('previoustrack', prevChapter);
        navigator.mediaSession.setActionHandler('nexttrack', nextChapter);
    }
}

function getNextChapterId(currentId) {
    const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
    const idx = sortedNums.indexOf(currentId);
    if (idx !== -1 && idx < sortedNums.length - 1) {
        return sortedNums[idx + 1];
    }
    return null;
}

function parseChapterSentences(chapterId) {
    const ch = currentChapters[chapterId];
    if (!ch) return [];
    const list = [];
    // Title is always index 0
    list.push(`Chương ${chapterId}: ${ch.title}`);

    const paragraphs = ch.content.split('\n').filter(p => p.trim());
    paragraphs.forEach(p => {
        list.push(p.trim());
    });
    return list;
}

// Single Audio Player State
const audioPlayer = new Audio();

audioPlayer.onplay = () => {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
    }
};

let nextAudioUrl = null;
let isPreloadingNext = false;

// Concurrency Control
class RequestQueue {
    constructor(concurrency) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
    }

    add(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.next();
        });
    }

    next() {
        if (this.running >= this.concurrency || this.queue.length === 0) return;
        const { fn, resolve, reject } = this.queue.shift();
        this.running++;
        fn().then(resolve).catch(reject).finally(() => {
            this.running--;
            this.next();
        });
    }
}

const preloadQueue = new RequestQueue(2); // Limit to 2 concurrent requests

async function startLiveTTS() {
    console.log("startLiveTTS called. Current Chapter:", currentChapterId);
    if (!currentChapterId) { showToast("Vui lòng chọn chương để đọc!", "error"); return; }

    if (isPlaying) {
        console.log("Stopping playback...");
        isPlaying = false;
        audioPlayer.pause();
        document.querySelectorAll('.sentence.playing').forEach(el => el.classList.remove('playing'));
        document.getElementById('speakBtn').innerHTML = '<span>🔊</span> Đọc Ngay';
        document.getElementById('status').textContent = '';
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }
        return;
    }

    let voice = document.getElementById("ttsVoice").value;
    let speed = parseFloat(document.getElementById("ttsSpeed").value);
    const btn = document.getElementById("speakBtn");
    const status = document.getElementById("status");
    const sentenceElements = document.querySelectorAll('.sentence');

    if (sentenceElements.length === 0) { showToast("Không tìm thấy câu nào để đọc!", "error"); return; }

    let currentIndex = getSavedSentenceIndex();
    console.log("Starting from index:", currentIndex);
    if (currentIndex > 0) {
        showToast(`Tiếp tục từ câu ${currentIndex + 1}...`, "success");
    }

    isPlaying = true;
    playbackSessionId++; // Start new session
    const currentSessionId = playbackSessionId;

    btn.innerHTML = '<span>⏸️</span> Dừng';
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
    }

    // Network Handling
    window.addEventListener('online', () => {
        console.log("Network back online! Retrying...");
        showToast("Đã kết nối lại mạng!", "success");
    });

    // Visibility Handling for "Catch Up"
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isPlaying) {
            // User came back, scroll to current sentence
            const currentEl = document.querySelector('.sentence.playing');
            if (currentEl) {
                currentEl.scrollIntoView({ behavior: 'auto', block: 'center' });
            } else if (currentIndex < sentenceElements.length) {
                // If no element has class (because we skipped updates), find by index
                const el = sentenceElements[currentIndex];
                document.querySelectorAll('.sentence.playing').forEach(e => e.classList.remove('playing'));
                el.classList.add('playing');
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
        }
    });

    async function fetchWithRetry(url, options, retries = 9, backoff = 1000) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    throw new Error(`HTTP Error ${response.status}`);
                }
                throw new Error(`Server Error ${response.status}`);
            }
            return response;
        } catch (err) {
            if (retries > 0) {
                console.warn(`Fetch failed, retrying in ${backoff}ms... (${retries} retries left)`, err);
                await new Promise(r => setTimeout(r, backoff));
                return fetchWithRetry(url, options, retries - 1, backoff * 2);
            }
            throw err;
        }
    }

    async function getAudioUrl(text, index, chapterId) {
        if (!text) return null;

        // Sanitize text for TTS: Remove brackets and trim
        // This prevents the TTS engine from freezing on symbols like "】" or "]"
        const sanitizedText = text.replace(/[\[\]【】]/g, "").trim();

        // If text becomes empty after sanitization (e.g. was just "】"), skip it
        if (!sanitizedText) return null;

        if (!chapterId) chapterId = currentChapterId;

        // Initialize buffer if needed
        if (!window.preloadBuffer) window.preloadBuffer = new Map();

        const key = `${chapterId}_${index}`;

        // Check buffer
        if (window.preloadBuffer.has(key)) {
            const cached = window.preloadBuffer.get(key);
            if (cached) return cached; // Return the Promise
        }

        // Create new request promise
        const promise = preloadQueue.add(async () => {
            try {
                voice = document.getElementById("ttsVoice").value;
                speed = parseFloat(document.getElementById("ttsSpeed").value);
                const resp = await fetchWithRetry("/api/tts-live", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: sanitizedText, voice, speed })
                }, 3, 1000);
                const data = await resp.json();
                const audioBlob = base64ToBlob(data.audio, data.mimeType);
                return URL.createObjectURL(audioBlob);
            } catch (err) {
                console.error("Error fetching audio:", err);
                // Remove from buffer on error so it can be retried
                window.preloadBuffer.delete(key);
                return null;
            }
        });

        // Store promise in buffer
        window.preloadBuffer.set(key, promise);

        return promise;
    }

    async function playSentence(index, sessionId) {
        if (!isPlaying || sessionId !== playbackSessionId) return;
        if (index >= sentenceElements.length) {
            // End of chapter
            if (stopAtEndOfChapter) {
                showToast("Đã dừng phát theo hẹn giờ.", "success");
                stopAtEndOfChapter = false;
                document.getElementById('sleepTimerBtn').classList.remove('active-timer');
                isPlaying = false;
                btn.innerHTML = '<span>🔊</span> Đọc Ngay';
                return;
            }
            console.log("Chapter finished. Moving to next...");
            const hasNext = nextChapter();
            if (!hasNext) {
                isPlaying = false;
                btn.innerHTML = '<span>🔊</span> Đọc Ngay';
                status.textContent = '✅ Hoàn tất!';
            }
            return;
        }

        const sentenceEl = sentenceElements[index];
        const text = sentenceEl.textContent.trim();

        // Background Optimization: Skip DOM updates if hidden
        if (!document.hidden) {
            status.textContent = `⏳ Đang đọc câu ${index + 1}/${sentenceElements.length}...`;

            if (isAutoScrollEnabled) {
                document.querySelectorAll('.sentence.playing').forEach(el => el.classList.remove('playing'));
                sentenceEl.classList.add('playing');
                const rect = sentenceEl.getBoundingClientRect();
                if (rect.top < 0 || rect.bottom > window.innerHeight) {
                    sentenceEl.scrollIntoView({ behavior: 'auto', block: 'center' });
                }
            }
        }
        saveProgress(index);

        // Get Audio (using buffer)
        let audioUrl;
        try {
            audioUrl = await getAudioUrl(text, index, currentChapterId);
        } catch (e) {
            console.error("Failed to get audio:", e);
        }

        if (!audioUrl) {
            console.error("Failed to get audio for sentence", index);
            // Skip to next sentence after short delay
            setTimeout(() => playSentence(index + 1, sessionId), 500);
            return;
        }

        // Play
        audioPlayer.src = audioUrl;
        audioPlayer.onended = () => {
            if (sessionId !== playbackSessionId) return;
            currentIndex++;
            playSentence(currentIndex, sessionId);
        };
        audioPlayer.onerror = (e) => {
            if (sessionId !== playbackSessionId) return;
            console.error("Playback error:", e);
            setTimeout(() => playSentence(index + 1, sessionId), 500);
        };

        try {
            await audioPlayer.play();

            // [OPTIMIZATION] Preload next audio (just fetch blob, don't assign to player)
            const nextIndex = index + 1;
            if (nextIndex < sentenceElements.length) {
                const nextText = sentenceElements[nextIndex].textContent.trim();
                // We use the same getAudioUrl which handles caching/queueing
                getAudioUrl(nextText, nextIndex, currentChapterId).catch(e => console.warn("Background preload failed", e));
            }

            const PRELOAD_COUNT = 25;

            // Cleanup old buffer items (keep previous 1 for potential replay/overlap)
            if (window.preloadBuffer) {
                for (const [key, promise] of window.preloadBuffer.entries()) {
                    const parts = key.split('_');
                    if (parts.length === 2) {
                        const chId = parseInt(parts[0]);
                        const idx = parseInt(parts[1]);
                        if (chId === currentChapterId && idx < index - 1) { // Aggressive cleanup for current chapter
                            promise.then(url => {
                                if (url) URL.revokeObjectURL(url);
                            });
                            window.preloadBuffer.delete(key);
                        }
                    }
                }
            }

            // Queue preloads
            for (let k = 1; k <= PRELOAD_COUNT; k++) {
                const targetIdx = index + k;
                if (targetIdx < sentenceElements.length) {
                    const targetText = sentenceElements[targetIdx].textContent.trim();
                    getAudioUrl(targetText, targetIdx, currentChapterId);
                } else {
                    // Cross-chapter preload
                    const nextId = getNextChapterId(currentChapterId);
                    if (nextId) {
                        if (cachedNextChapterId !== nextId) {
                            cachedNextSentences = parseChapterSentences(nextId);
                            cachedNextChapterId = nextId;
                        }
                        const nextIdx = targetIdx - sentenceElements.length;
                        if (cachedNextSentences && nextIdx < cachedNextSentences.length) {
                            getAudioUrl(cachedNextSentences[nextIdx], nextIdx, nextId);
                        }
                    }
                }
            }

        } catch (err) {
            console.error("Play failed:", err);
            isPlaying = false;
            btn.innerHTML = '<span>🔊</span> Đọc Ngay';
        }
    }

    // Start the loop
    playSentence(currentIndex, currentSessionId);
}

// Sleep Timer Functions
function openSleepTimerModal() {
    document.getElementById('sleepTimerModal').classList.add('show');
}

function closeSleepTimerModal() {
    document.getElementById('sleepTimerModal').classList.remove('show');
}

function setSleepTimer(minutes) {
    closeSleepTimerModal();

    // Clear existing timer and countdown
    if (sleepTimer) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
    }
    if (sleepTimerInterval) {
        clearInterval(sleepTimerInterval);
        sleepTimerInterval = null;
    }
    stopAtEndOfChapter = false;

    const btn = document.getElementById('sleepTimerBtn');
    const countdownEl = document.getElementById('sleepTimerCountdown');
    const countdownTimeEl = document.getElementById('countdownTime');

    if (minutes === null) {
        showToast("Đã hủy hẹn giờ tắt.", "success");
        btn.classList.remove('active-timer');
        if (countdownEl) countdownEl.style.display = 'none';
        return;
    }

    btn.classList.add('active-timer');

    if (minutes === 'chapter') {
        stopAtEndOfChapter = true;
        showToast("Sẽ dừng sau khi hết chương này.", "success");
        if (countdownEl) {
            countdownEl.style.display = 'block';
            countdownTimeEl.textContent = 'Hết chương';
        }
    } else {
        const ms = minutes * 60 * 1000;
        let remainingSeconds = minutes * 60;

        showToast(`Sẽ dừng phát sau ${minutes} phút.`, "success");

        // Show and update countdown display
        if (countdownEl) {
            countdownEl.style.display = 'block';

            // Update countdown every second
            const updateCountdown = () => {
                const mins = Math.floor(remainingSeconds / 60);
                const secs = remainingSeconds % 60;
                countdownTimeEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                remainingSeconds--;

                if (remainingSeconds < 0) {
                    clearInterval(sleepTimerInterval);
                    sleepTimerInterval = null;
                    countdownEl.style.display = 'none';
                }
            };

            // Initial display
            updateCountdown();

            // Update every second
            sleepTimerInterval = setInterval(updateCountdown, 1000);
        }

        sleepTimer = setTimeout(() => {
            if (isPlaying) {
                console.log("Sleep Timer: Time reached. Stopping playback.");
                isPlaying = false;
                audioPlayer.pause();
                document.querySelectorAll('.sentence.playing').forEach(el => el.classList.remove('playing'));
                document.getElementById('speakBtn').innerHTML = '<span>🔊</span> Đọc Ngay';
                document.getElementById('status').textContent = '';
                showToast("Đã dừng phát theo hẹn giờ.", "success");
            }
            btn.classList.remove('active-timer');
            if (countdownEl) countdownEl.style.display = 'none';
            if (sleepTimerInterval) {
                clearInterval(sleepTimerInterval);
                sleepTimerInterval = null;
            }
            sleepTimer = null;
        }, ms);
    }
}

// Close sleep timer modal on outside click
document.getElementById('sleepTimerModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('sleepTimerModal')) {
        closeSleepTimerModal();
    }
});

function toggleAutoScroll() {
    isAutoScrollEnabled = !isAutoScrollEnabled;
    const btn = document.getElementById('autoScrollBtn');
    if (isAutoScrollEnabled) {
        btn.innerHTML = '📜';
        btn.classList.remove('disabled-feature');
        showToast("Đã BẬT tự động cuộn & highlight", "success");
        // Apply immediately to current sentence if playing
        if (isPlaying) {
            const currentIndex = getSavedSentenceIndex();
            const sentences = document.querySelectorAll('.sentence');
            if (sentences[currentIndex]) {
                sentences[currentIndex].classList.add('playing');
                sentences[currentIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    } else {
        btn.innerHTML = '<span style="opacity:0.5;text-decoration:line-through">📜</span>';
        btn.classList.add('disabled-feature');
        showToast("Đã TẮT tự động cuộn & highlight", "success");
        // Remove highlight immediately
        document.querySelectorAll('.sentence.playing').forEach(el => el.classList.remove('playing'));
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

// Modal functions
function showStartModal() {
    const btn = document.getElementById("speakBtn");
    if (btn.textContent.includes("Dừng")) {
        startLiveTTS();
        return;
    }
    if (!currentChapterId) {
        showToast("Vui lòng chọn chương để đọc!", "error");
        return;
    }

    // Update saved position text
    const savedIndex = getSavedSentenceIndex();
    const posText = document.getElementById('savedPositionText');
    if (savedIndex > 0) {
        posText.textContent = `Tiếp tục từ câu ${savedIndex + 1}`;
    } else {
        posText.textContent = 'Bắt đầu từ đầu chương';
    }

    document.getElementById('startModal').classList.add('show');
}

function hideStartModal() {
    document.getElementById('startModal').classList.remove('show');
}

function selectStartOption(option) {
    if (option === 'continue') {
        hideStartModal();
        startLiveTTS();
    } else if (option === 'choose') {
        showSentenceSelector();
    }
}

function showSentenceSelector() {
    const sentences = document.querySelectorAll('.sentence');
    if (sentences.length === 0) {
        showToast("Không tìm thấy câu nào!", "error");
        return;
    }

    const modalBody = document.getElementById('modalBody');
    let html = '<div class="sentence-list">';
    sentences.forEach((sent, idx) => {
        const text = sent.textContent.trim();
        const preview = text.length > 75 ? text.substring(0, 75) + '...' : text;
        html += `<div class="sentence-option ${idx === getSavedSentenceIndex() ? 'selected' : ''}" onclick="selectSentence(${idx})">
            <strong>Câu ${idx + 1}:</strong> ${preview}
        </div>`;
    });
    html += '</div>';
    html += '<div class="modal-footer">';
    html += '<button class="modal-btn modal-btn-secondary" onclick="backToStartOptions()">« Quay lại</button>';
    html += '</div>';

    modalBody.innerHTML = html;
}

function backToStartOptions() {
    const savedIndex = getSavedSentenceIndex();
    const contentSave = `Tiếp tục từ câu ${savedIndex + 1}`;
    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
        <div class="modal-option" onclick="selectStartOption('continue')">
            <h4>📍 Tiếp tục từ câu đã lưu</h4>
            <p id="savedPositionText">${contentSave}</p>
        </div>
        <div class="modal-option" onclick="selectStartOption('choose')">
            <h4>🎯 Chọn câu để bắt đầu</h4>
            <p>Chọn câu cụ thể từ danh sách</p>
        </div>
    `;
}

function selectSentence(index) {
    hideStartModal();
    // Reset modal body for next time
    setTimeout(backToStartOptions, 300);
    // Save this position and start from here
    saveProgress(index, true); // Immediate save on manual selection
    showToast(`Bắt đầu từ câu ${index + 1}`, "success");
    startLiveTTS();
}

// Click outside modal to close
document.addEventListener('click', (e) => {
    const modal = document.getElementById('startModal');
    if (e.target === modal) {
        hideStartModal();
        backToStartOptions();
    }
});

function scrollToCurrentSentence() {
    let target = document.querySelector('.sentence.playing');

    if (!target) {
        // Fallback to saved position
        const savedIndex = getSavedSentenceIndex();
        const sentences = document.querySelectorAll('.sentence');
        if (sentences[savedIndex]) {
            target = sentences[savedIndex];
        }
    }

    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash effect
        const originalBg = target.style.backgroundColor;
        target.style.backgroundColor = '#fde047'; // Yellow flash
        target.style.transition = 'background-color 0.5s';
        setTimeout(() => {
            target.style.backgroundColor = originalBg;
        }, 1000);
        showToast("Đã cuộn đến vị trí đang đọc", "success");
    } else {
        showToast("Chưa xác định được vị trí đọc", "warning");
    }
}
function onChangeSetting(prop, value) {
    let settings = getStorage('appSettings');
    if (settings) {
        settings = JSON.parse(settings);
    } else {
        settings = {};
    }
    if (prop === "voice") {
        settings.voice = value;
    }
    if (prop === "speed") {
        settings.speed = value;
    }
    setStorage('appSettings', JSON.stringify(settings));
}
// Settings Functions
function loadSettings() {
    const settingsStr = getStorage('appSettings');
    if (settingsStr) {
        try {
            const settings = JSON.parse(settingsStr);
            if (settings.theme) setTheme(settings.theme, false);
            if (settings.font) setFont(settings.font, false);
            if (settings.fontSize) applyFontSize(settings.fontSize, false);
            if (settings.voice) {
                const ttsVoice = document.getElementById('ttsVoice');
                ttsVoice.value = settings.voice;
            }
            if (settings.speed) {
                const ttsSpeed = document.getElementById('ttsSpeed');
                ttsSpeed.value = settings.speed;
            }
        } catch (e) {
            console.error("Error loading settings", e);
        }
    } else {
        // Default settings
        setTheme('light', false);
        applyFontSize(18, false); // Default 18px as per HTML
    }
}

function saveSettings() {
    let settings = getStorage('appSettings');
    if (settings) {
        settings = JSON.parse(settings);
    } else {
        settings = {};
    }
    const theme = document.body.className.replace('theme-', '') || 'light';
    const font = document.getElementById('fontSelect').value;
    settings = {
        ...settings,
        theme: theme === 'light' || theme === 'dark' || theme === 'ancient' || theme === 'modern' ? theme : 'light',
        font: font,
        fontSize: currentFontSize
    };
    setStorage('appSettings', JSON.stringify(settings));
}

function openSettingsModal() {
    document.getElementById('settingsModal').classList.add('show');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('show');
}

function setTheme(theme, save = true) {
    document.body.className = `theme-${theme}`;
    document.querySelectorAll('.theme-option').forEach(el => {
        el.classList.remove('active');
        if (el.classList.contains(theme)) el.classList.add('active');
    });
    if (save) saveSettings();
}

function setFont(font, save = true) {
    document.body.style.fontFamily = font;
    const select = document.getElementById('fontSelect');
    if (select) select.value = font;
    if (save) saveSettings();
}

let currentFontSize = 18;
function adjustFontSize(change) {
    currentFontSize += change;
    if (currentFontSize < 14) currentFontSize = 14;
    if (currentFontSize > 30) currentFontSize = 30;
    applyFontSize(currentFontSize);
}

function applyFontSize(size, save = true) {
    currentFontSize = size;
    // Apply to reading area specifically
    const readingArea = document.getElementById('readingArea');
    if (readingArea) {
        readingArea.style.fontSize = `${size}px`;
        // Also update line-height for better readability at larger sizes
        readingArea.style.lineHeight = `${size * 1.6}px`;
    }

    // Also update the display
    const display = document.getElementById('currentFontSize');
    if (display) display.textContent = `${size}px`;

    if (save) saveSettings();
}

// Close settings modal on outside click
document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settingsModal')) {
        closeSettingsModal();
    }
});

init();
