
// State
let currentStoryId = null;
let currentChapterId = null;
let currentChapters = {}; // { id: { title, content } }
let isPlaying = false;
let audioPlayer = new Audio();
let playbackSessionId = 0;
let nextChapterBlobUrl = null; // Preload next chapter
let nextChapterId = null;
let saveInterval = null;
let sleepTimer = null;
let sleepTimerEnd = null;
let stopAtEndOfChapter = false;
let currentMetadataHandler = null; // <--- THÊM DÒNG NÀY

// DOM Elements
const els = {
    storySelect: document.getElementById('storySelect'),
    chapterSelect: document.getElementById('chapterSelect'),
    playBtn: document.getElementById('playBtn'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    playIcon: document.getElementById('playIcon'),
    pauseIcon: document.getElementById('pauseIcon'),
    trackTitle: document.getElementById('currentTrackTitle'),
    storyTitle: document.getElementById('currentStoryTitle'),
    progressBar: document.getElementById('progressBar'),
    currentTime: document.getElementById('currentTime'),
    totalTime: document.getElementById('totalTime'),
    voiceSelect: document.getElementById('voiceSelect'),
    speedSelect: document.getElementById('speedSelect'),
    loading: document.getElementById('loadingOverlay'),
    toast: document.getElementById('toast'),
    progressContainer: document.querySelector('.progress-container'),
    sleepTimerBtn: document.getElementById('sleepTimerBtn'),
    sleepTimerLabel: document.getElementById('sleepTimerLabel'),
    sleepTimerModal: document.getElementById('sleepTimerModal'),
    closeTimerModal: document.getElementById('closeTimerModal'),
    loadingText: document.getElementById('loadingText'),
    timerOpts: document.querySelectorAll('.timer-opt')
};

// Initialization
async function init() {
    showLoading(true);
    try {
        const resp = await fetch('/api/stories-listen');
        const stories = await resp.json();
        stories.forEach(story => {
            const option = document.createElement('option');
            option.value = story.id;
            option.textContent = story.title;
            els.storySelect.appendChild(option);
        });

        // Load saved progress
        await loadProgress();

    } catch (err) {
        showToast('Lỗi tải danh sách truyện', 'error');
        console.error(err);
    } finally {
        showLoading(false);
    }

    // Event Listeners
    els.storySelect.addEventListener('change', (e) => loadStory(e.target.value));
    els.chapterSelect.addEventListener('change', (e) => {
        if (e.target.value) playChapter(parseInt(e.target.value));
    });
    els.playBtn.addEventListener('click', togglePlay);
    els.prevBtn.addEventListener('click', prevChapter);
    els.nextBtn.addEventListener('click', nextChapter);

    // Audio Events
    audioPlayer.addEventListener('timeupdate', updateProgress);
    audioPlayer.addEventListener('loadedmetadata', () => {
        els.totalTime.textContent = formatTime(audioPlayer.duration);
    });
    audioPlayer.addEventListener('ended', onAudioEnded);
    audioPlayer.addEventListener('error', (e) => {
        console.error("Audio error", e);
        showToast('Lỗi phát audio', 'error');
        stopPlayback();
    });

    // Save progress on pause and unload
    audioPlayer.addEventListener('pause', () => saveProgress(true));
    window.addEventListener('beforeunload', () => saveProgress(true));

    // Seek
    els.progressContainer.addEventListener('click', (e) => {
        if (!audioPlayer.duration) return;
        const rect = els.progressContainer.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        audioPlayer.currentTime = percent * audioPlayer.duration;
    });

    // Sleep Timer UI
    if (els.sleepTimerBtn) {
        els.sleepTimerBtn.addEventListener('click', () => {
            els.sleepTimerModal.style.display = 'flex';
        });
        els.closeTimerModal.addEventListener('click', () => {
            els.sleepTimerModal.style.display = 'none';
        });
        els.timerOpts.forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.val;
                setSleepTimer(val);
                els.sleepTimerModal.style.display = 'none';
            });
        });
    }

    // Auto save interval
    saveInterval = setInterval(() => {
        if (isPlaying) saveProgress();
        checkSleepTimer();
    }, 1000);
}

// Sleep Timer Logic
function setSleepTimer(val) {
    if (val === 'off') {
        clearSleepTimer();
        showToast('Đã tắt hẹn giờ', 'info');
        return;
    }

    if (val === 'end') {
        stopAtEndOfChapter = true;
        sleepTimerEnd = null;
        els.sleepTimerLabel.textContent = 'Hết chương';
        els.sleepTimerLabel.style.color = 'var(--primary)';
        showToast('Sẽ dừng khi hết chương', 'success');
        return;
    }

    const minutes = parseInt(val);
    if (!isNaN(minutes)) {
        stopAtEndOfChapter = false;
        sleepTimerEnd = Date.now() + minutes * 60 * 1000;
        els.sleepTimerLabel.style.color = 'var(--primary)';
        showToast(`Hẹn giờ tắt sau ${minutes} phút`, 'success');
        checkSleepTimer(); // Update label immediately
    }
}

function clearSleepTimer() {
    stopAtEndOfChapter = false;
    sleepTimerEnd = null;
    els.sleepTimerLabel.textContent = 'Hẹn giờ';
    els.sleepTimerLabel.style.color = 'var(--text-sub)';
}

function checkSleepTimer() {
    if (sleepTimerEnd) {
        const remaining = sleepTimerEnd - Date.now();
        if (remaining <= 0) {
            pausePlayback();
            clearSleepTimer();
            showToast('Đã dừng phát theo hẹn giờ', 'info');
        } else {
            // Update label with countdown
            const m = Math.ceil(remaining / 60000);
            els.sleepTimerLabel.textContent = `${m} phút`;
        }
    }
}

// Progress Management
function saveProgress(force = false) {
    if (!currentStoryId || !currentChapterId) return;

    const state = {
        storyId: currentStoryId,
        chapterId: currentChapterId,
        currentTime: audioPlayer.currentTime,
        timestamp: Date.now()
    };

    try {
        localStorage.setItem('audioPlayerProgress', JSON.stringify(state));
        if (force) console.log("Progress saved:", state);
    } catch (e) {
        console.warn("Failed to save progress", e);
    }
}

async function loadProgress() {
    try {
        const saved = localStorage.getItem('audioPlayerProgress');
        if (!saved) return;

        const state = JSON.parse(saved);
        if (!state.storyId || !state.chapterId) return;

        // Restore Story
        els.storySelect.value = state.storyId;
        if (els.storySelect.value !== state.storyId) return; // Story might verify exist

        await loadStory(state.storyId);

        // Restore Chapter
        els.chapterSelect.value = state.chapterId;
        if (parseInt(els.chapterSelect.value) !== state.chapterId) return;

        showToast('Đang khôi phục tiến trình...', 'info');

        // Play and seek
        await playChapter(state.chapterId, state.currentTime);

        // Auto pause if it was restored (optional, maybe user wants to click play)
        // For now, let's pause it so it doesn't blast audio on load, but seek to position
        pausePlayback();

    } catch (e) {
        console.error("Failed to load progress", e);
    }
}

// Logic
async function loadStory(storyId) {
    if (!storyId) return;
    currentStoryId = storyId;
    showLoading(true);
    els.chapterSelect.innerHTML = '<option value="">-- Chọn Chương --</option>';
    els.chapterSelect.disabled = true;
    stopPlayback();

    try {
        const resp = await fetch(`/api/story-content/${storyId}`);
        if (!resp.ok) throw new Error("Lỗi tải nội dung");
        const data = await resp.json();
        currentChapters = extractChapters(data.content);

        const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
        sortedNums.forEach(num => {
            const option = document.createElement('option');
            option.value = num;
            option.textContent = `Chương ${num}: ${currentChapters[num].title}`;
            els.chapterSelect.appendChild(option);
        });

        els.chapterSelect.disabled = false;
        els.storyTitle.textContent = els.storySelect.options[els.storySelect.selectedIndex].text;
        showToast('Đã tải xong truyện', 'success');
    } catch (err) {
        showToast('Lỗi tải truyện: ' + err.message, 'error');
    } finally {
        showLoading(false);
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

async function playChapter(chapterId, startTime = 0) {
    if (!currentChapters[chapterId]) return;

    currentChapterId = chapterId;
    els.chapterSelect.value = chapterId;
    els.trackTitle.textContent = `Chương ${chapterId}: ${currentChapters[chapterId].title}`;

    // Update UI
    els.prevBtn.disabled = false;
    els.nextBtn.disabled = false;
    els.playBtn.disabled = false;

    // Check if preloaded
    if (nextChapterId === chapterId && nextChapterBlobUrl && startTime === 0) {
        console.log("Using preloaded audio");
        startPlayback(nextChapterBlobUrl);
        nextChapterBlobUrl = null;
        nextChapterId = null;
    } else {
        // Fetch new
        const fullText = `Chương ${chapterId}. ${currentChapters[chapterId].title}. \n ${currentChapters[chapterId].content}`;
        showLoading(true);
        try {
            const blobUrl = await getAudioUrl(fullText, chapterId);
            if (blobUrl) {
                startPlayback(blobUrl, startTime);
            } else {
                showToast('Không thể tạo audio', 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Lỗi tạo audio', 'error');
        } finally {
            showLoading(false);
        }
    }

    // Preload next chapter
    preloadNextChapter(chapterId);
    // Thêm vào cuối hàm playChapter
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: `Chương ${chapterId}: ${currentChapters[chapterId].title}`,
            artist: els.storySelect.options[els.storySelect.selectedIndex].text,
            album: els.storySelect.options[els.storySelect.selectedIndex].text,
            // artwork: [{ src: 'link-anh-bia.jpg', sizes: '512x512', type: 'image/jpeg' }] // Nếu có ảnh bìa
        });

        navigator.mediaSession.setActionHandler('play', () => togglePlay());
        navigator.mediaSession.setActionHandler('pause', () => togglePlay());
        navigator.mediaSession.setActionHandler('previoustrack', () => prevChapter());
        navigator.mediaSession.setActionHandler('nexttrack', () => nextChapter());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.fastSeek && 'fastSeek' in audioPlayer) {
                audioPlayer.fastSeek(details.seekTime);
                return;
            }
            audioPlayer.currentTime = details.seekTime;
            updateProgress();
        });
    }
}

async function preloadNextChapter(currentId) {
    const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
    const idx = sortedNums.indexOf(currentId);
    if (idx < sortedNums.length - 1) {
        const nextId = sortedNums[idx + 1];
        if (nextChapterId === nextId && nextChapterBlobUrl) return; // Already preloaded

        // Clear old preload
        if (nextChapterBlobUrl) URL.revokeObjectURL(nextChapterBlobUrl);

        nextChapterId = nextId;
        console.log("Preloading chapter", nextId);
        const fullText = `Chương ${nextId}. ${currentChapters[nextId].title}. \n ${currentChapters[nextId].content}`;
        try {
            nextChapterBlobUrl = await getAudioUrl(fullText, nextId);
        } catch (e) {
            console.warn("Preload failed", e);
            nextChapterId = null;
            nextChapterBlobUrl = null;
        }
    }
}

function togglePlay() {
    if (isPlaying) {
        pausePlayback();
    } else {
        if (currentChapterId) {
            if (audioPlayer.src) {
                audioPlayer.play();
                isPlaying = true;
                updatePlayButton();
            } else {
                playChapter(currentChapterId);
            }
        } else {
            showToast('Vui lòng chọn chương', 'warning');
        }
    }
}

function startPlayback(url, startTime = 0) {
    // 1. Dọn dẹp URL blob cũ nếu có để tránh rò rỉ bộ nhớ
    if (audioPlayer.src && audioPlayer.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioPlayer.src);
    }

    // 2. QUAN TRỌNG: Gỡ bỏ sự kiện chờ cũ nếu người dùng bấm chuyển bài quá nhanh
    if (currentMetadataHandler) {
        audioPlayer.removeEventListener('loadedmetadata', currentMetadataHandler);
        currentMetadataHandler = null;
    }

    // 3. Gán src mới
    audioPlayer.src = url;

    // 4. Tạo hàm xử lý mới
    currentMetadataHandler = () => {
        // Chỉ set thời gian khi metadata đã tải xong
        audioPlayer.currentTime = startTime;

        const playPromise = audioPlayer.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                isPlaying = true;
                updatePlayButton();
                updateProgress(); // Cập nhật UI ngay lập tức
            }).catch(e => {
                // Bỏ qua lỗi do người dùng bấm stop/next quá nhanh
                if (e.name === 'AbortError') return;

                console.error("Play failed", e);
                isPlaying = false;
                updatePlayButton();
            });
        }
    };

    // 5. Lắng nghe sự kiện (chỉ chạy 1 lần cho file này)
    audioPlayer.addEventListener('loadedmetadata', currentMetadataHandler, { once: true });

    // 6. Trigger load (cần thiết cho một số trình duyệt mobile)
    audioPlayer.load();
}

// Thêm đoạn này vào trong hàm init(), phần Event Listeners
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Khi người dùng mở lại tab, đồng bộ ngay lập tức
        if (audioPlayer && audioPlayer.duration) {
            updateProgress();
            updatePlayButton();
        }
    }
});

function pausePlayback() {
    isPlaying = false;
    audioPlayer.pause();
    updatePlayButton();
}

function stopPlayback() {
    isPlaying = false;
    audioPlayer.pause();
    updatePlayButton();
    els.progressBar.style.width = '0%';
    els.currentTime.textContent = '0:00';
    els.totalTime.textContent = '--:--';
}

function updatePlayButton() {
    if (isPlaying) {
        els.playIcon.style.display = 'none';
        els.pauseIcon.style.display = 'block';
        els.playBtn.classList.add('playing');
    } else {
        els.playIcon.style.display = 'block';
        els.pauseIcon.style.display = 'none';
        els.playBtn.classList.remove('playing');
    }
}

function updateProgress() {
    if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
        const currentTime = audioPlayer.currentTime;
        const duration = audioPlayer.duration;

        const percent = (currentTime / duration) * 100;
        els.progressBar.style.width = `${percent}%`;
        els.currentTime.textContent = formatTime(currentTime);

        // Cập nhật Media Session (Hiển thị trên màn hình khóa điện thoại)
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: audioPlayer.playbackRate,
                position: currentTime
            });
        }
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function onAudioEnded() {
    if (stopAtEndOfChapter) {
        stopPlayback();
        clearSleepTimer();
        showToast('Đã dừng phát (Hết chương)', 'info');
    } else {
        nextChapter();
    }
}

async function getAudioUrl(text, currentLoadingChapterId) {
    const voice = els.voiceSelect.value;
    const speed = parseFloat(els.speedSelect.value);

    const response = await fetch('/api/tts-live-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, speed })
    });

    if (!response.ok) throw new Error('TTS Error');

    // Thiết lập Reader để đọc stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Giải mã byte thành text
        buffer += decoder.decode(value, { stream: true });

        // Tách các dòng JSON (do server gửi kèm \n)
        const lines = buffer.split('\n');

        // Giữ lại phần dư chưa thành dòng hoàn chỉnh (nếu có)
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const data = JSON.parse(line);

                if (data.type === 'progress') {
                    // CẬP NHẬT UI Ở ĐÂY
                    showToast(`Đang tải: ${data.val}%`, 'info');
                    // console.log(`Đang tải Chương ${currentLoadingChapterId}: ${data.val}%`);
                    els.loadingText.textContent = `Đang tải Chương ${currentLoadingChapterId}: ${data.val}%`;
                    // Ví dụ: updateLoadingBar(data.val);
                }
                else if (data.type === 'done') {
                    // HOÀN THÀNH
                    const blob = base64ToBlob(data.audio, data.mimeType);

                    // showToast(`Tải hoàn tất Chương ${currentLoadingChapterId}`, 'info');
                    els.loadingText.textContent = `Tải hoàn tất Chương ${currentLoadingChapterId}`;
                    return URL.createObjectURL(blob);
                }
                else if (data.type === 'error') {
                    throw new Error(data.msg);
                }
            } catch (e) {
                console.error("Lỗi parse JSON stream", e);
            }
        }
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

function prevChapter() {
    const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
    const idx = sortedNums.indexOf(currentChapterId);
    if (idx > 0) {
        playChapter(sortedNums[idx - 1]);
    } else {
        showToast('Đây là chương đầu tiên', 'warning');
    }
}

function nextChapter() {
    const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
    const idx = sortedNums.indexOf(currentChapterId);
    if (idx < sortedNums.length - 1) {
        playChapter(sortedNums[idx + 1]);
    } else {
        showToast('Đã hết truyện!', 'success');
        stopPlayback();
    }
}

function showLoading(show) {
    if (show) els.loading.classList.add('active');
    else els.loading.classList.remove('active');
}

function showToast(msg, type = 'info') {
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : '⚠️');
    els.toast.querySelector('.toast-icon').textContent = icon;
    els.toast.querySelector('.toast-message').textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2000);
}

// Start
init();
