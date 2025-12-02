document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================
    // 1. KHỞI TẠO BIẾN TOÀN CỤC (STATE)
    // ==========================================================
    let currentStoryId = null;
    let currentChapterId = null;
    let currentChapters = {};
    let isPlaying = false;
    let audioPlayer = new Audio();

    // CONFIG CHO IOS
    audioPlayer.preload = 'none';

    // QUẢN LÝ REQUEST (Tách biệt Play và Preload để tránh ngắt nhạc)
    let playFetchController = null;
    let preloadFetchController = null;

    // Preload & Cache
    let nextChapterData = null;
    let nextChapterId = null;
    let currentMetadataHandler = null;
    let savedStartTime = 0;

    // Timer & Settings
    let saveInterval = null;
    let sleepTimerEnd = null;
    let stopAtEndOfChapter = false;

    // Subtitle / Lyrics
    let currentSubtitles = [];
    let activeSubtitleIndex = -1;

    // Waveform
    let waveformData = [];
    const BAR_COUNT = 60;
    let lastDrawPercent = -1; // Biến tối ưu vẽ waveform

    // ==========================================================
    // 2. LẤY CÁC ELEMENT TỪ HTML 
    // ==========================================================
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
        toggleLyricsBtn: document.getElementById('toggleLyricsBtn'),
        subtitleContainer: document.getElementById('subtitleContainer'),
        albumArt: document.getElementById('albumArt'),
        waveformCanvas: document.getElementById('waveformCanvas'),
        currentTime: document.getElementById('currentTime'),
        totalTime: document.getElementById('totalTime'),
        voiceSelect: document.getElementById('voiceSelect'),
        speedSelect: document.getElementById('speedSelect'),
        loading: document.getElementById('loadingOverlay'),
        toast: document.getElementById('toast'),
        progressContainer: document.querySelector('.progress-container'),
        loadingText: document.getElementById('loadingText'),
        sleepTimerBtn: document.getElementById('sleepTimerBtn'),
        sleepTimerLabel: document.getElementById('sleepTimerLabel'),
        sleepTimerModal: document.getElementById('sleepTimerModal'),
        closeTimerModal: document.getElementById('closeTimerModal'),
        timerOpts: document.querySelectorAll('.timer-opt')
    };

    // ==========================================================
    // 3. HÀM INIT
    // ==========================================================
    async function init() {
        if (!els.playBtn || !els.storySelect) return;

        loadSettings();
        showLoading(true);
        try {
            const resp = await fetch('/api/stories-listen');
            if (resp.ok) {
                const stories = await resp.json();
                stories.forEach(story => {
                    const option = document.createElement('option');
                    option.value = story.id;
                    option.textContent = story.title;
                    els.storySelect.appendChild(option);
                });
            }
            await loadProgress();
        } catch (err) {
            showToast('Lỗi kết nối server', 'error');
            console.error(err);
        } finally {
            showLoading(false);
        }

        // --- GÁN SỰ KIỆN ---
        els.storySelect.addEventListener('change', (e) => loadStory(e.target.value));

        els.chapterSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                savedStartTime = 0;
                playChapter(parseInt(e.target.value));
            }
        });

        els.playBtn.addEventListener('click', togglePlay);
        if (els.prevBtn) els.prevBtn.addEventListener('click', prevChapter);
        if (els.nextBtn) els.nextBtn.addEventListener('click', nextChapter);

        if (els.speedSelect) {
            els.speedSelect.addEventListener('change', () => {
                if (currentChapterId) {
                    let currentPercent = 0;
                    if (audioPlayer.duration > 0) {
                        currentPercent = audioPlayer.currentTime / audioPlayer.duration;
                    }
                    const wasPlaying = isPlaying;
                    playChapter(currentChapterId, 0, currentPercent).then(() => {
                        if (!wasPlaying) audioPlayer.pause();
                    });
                    saveSettings();
                }
            });
        }

        if (els.voiceSelect) {
            els.voiceSelect.addEventListener('change', () => saveSettings());
        }

        if (els.toggleLyricsBtn) els.toggleLyricsBtn.addEventListener('click', toggleLyricsView);
        if (els.albumArt) els.albumArt.addEventListener('click', toggleLyricsView);

        // --- AUDIO EVENTS QUAN TRỌNG ---
        audioPlayer.addEventListener('timeupdate', updateProgress);
        audioPlayer.addEventListener('loadedmetadata', () => {
            if (els.totalTime) els.totalTime.textContent = formatTime(audioPlayer.duration);
        });
        audioPlayer.addEventListener('ended', onAudioEnded);

        // Fix iOS UI Sync: Khi hệ thống tự pause (do cuộc gọi), cập nhật UI
        audioPlayer.addEventListener('pause', () => {
            isPlaying = false;
            updatePlayButton();
            saveProgress(true);
        });
        audioPlayer.addEventListener('play', () => {
            isPlaying = true;
            updatePlayButton();
        });

        audioPlayer.addEventListener('error', (e) => {
            // Không show toast lỗi nếu là do abort chủ động
            if (audioPlayer.error && audioPlayer.error.code !== 20) {
                console.error("Audio error event:", e);
            }
            isPlaying = false;
            updatePlayButton();
        });

        if (els.progressContainer) {
            els.progressContainer.addEventListener('click', (e) => {
                const rect = els.progressContainer.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                if (!audioPlayer.src || audioPlayer.src === '') {
                    if (currentChapterId && currentChapters[currentChapterId]) {
                        playChapter(currentChapterId, 0);
                        return;
                    }
                }
                if (audioPlayer.duration) {
                    audioPlayer.currentTime = percent * audioPlayer.duration;
                    if (els.waveformCanvas) drawWaveform(percent);
                }
            });
        }

        setupTimerUI();
        saveInterval = setInterval(() => {
            if (isPlaying) saveProgress();
            checkSleepTimer();
        }, 1000);

        if (els.waveformCanvas) initWaveform();

        // Fix iOS: Update UI khi quay lại tab
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                updatePlayButton();
            }
        });
        window.addEventListener('beforeunload', () => saveProgress(true));
    }

    // ==========================================================
    // 4. HỒI SỨC CẤP CỨU (RECOVERY LOGIC) - QUAN TRỌNG
    // ==========================================================
    async function recoverAndPlay() {
        console.log("🚑 Kích hoạt hồi sức cấp cứu...");
        showLoading(true);

        // Lưu thời điểm cần resume
        let resumeTime = audioPlayer.currentTime > 0 ? audioPlayer.currentTime : savedStartTime;

        try {
            // --- CÁCH 1: THỬ LOAD LẠI SOURCE CŨ ---
            // Chỉ thành công nếu Blob chưa bị xóa khỏi RAM
            console.log("Thử cách 1: Reload source cũ...");
            audioPlayer.load();

            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Timeout")), 3000);
                audioPlayer.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
                audioPlayer.onerror = (e) => { clearTimeout(timer); reject(e); };
            });

            audioPlayer.currentTime = resumeTime;
            await audioPlayer.play();
            console.log("✅ Hồi sức cách 1 thành công!");
            isPlaying = true;
            updatePlayButton();

        } catch (e) {
            // --- CÁCH 2: TẢI LẠI TỪ SERVER ---
            // Nếu Blob bị xóa (do tắt máy lâu/cuộc gọi), phải fetch lại file mới
            console.warn("⚠️ Cách 1 thất bại. Chuyển sang Cách 2: Tải lại từ server...", e);

            if (currentChapterId) {
                // playChapter sẽ tự động fetch lại và tua đến resumeTime
                await playChapter(currentChapterId, resumeTime);
                console.log("✅ Hồi sức cách 2 thành công!");
            } else {
                showToast('Không thể khôi phục. Vui lòng chọn lại chương.', 'error');
                stopPlayback();
            }
        } finally {
            audioPlayer.onloadedmetadata = null;
            audioPlayer.onerror = null;
            showLoading(false);
        }
    }

    // ==========================================================
    // 5. CORE LOGIC (LOAD & PLAY)
    // ==========================================================
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
            if (els.storyTitle) els.storyTitle.textContent = els.storySelect.options[els.storySelect.selectedIndex].text;
            showToast('Đã tải truyện', 'success');
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

    async function playChapter(chapterId, startTime = 0, startPercent = null) {
        if (!currentChapters[chapterId]) return;

        currentChapterId = chapterId;
        if (els.chapterSelect) els.chapterSelect.value = chapterId;
        if (els.trackTitle) els.trackTitle.textContent = `Chương ${chapterId}: ${currentChapters[chapterId].title}`;

        els.playBtn.disabled = false;

        // --- FIX IOS: Hack để giữ audio context ---
        // Load rỗng ngay lập tức khi user tương tác
        if (!audioPlayer.src || audioPlayer.src === '') {
            audioPlayer.load();
        }

        let audioDataToPlay = null;

        // 1. Check Preload Cache
        if (nextChapterId === chapterId && nextChapterData && startPercent === null && startTime === 0) {
            console.log("Sử dụng cache preload");
            audioDataToPlay = nextChapterData;
            nextChapterData = null;
            nextChapterId = null;
        } else {
            // 2. Fetch mới
            const fullText = `Chương ${chapterId}. ${currentChapters[chapterId].title}. \n ${currentChapters[chapterId].content}`;
            showLoading(true);
            try {
                // isPreload = false
                const result = await getAudioUrl(fullText, chapterId, false);
                if (result) audioDataToPlay = result;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    console.error(e);
                    showToast('Lỗi tạo audio', 'error');
                }
                return;
            } finally {
                showLoading(false);
            }
        }

        if (audioDataToPlay && audioDataToPlay.audioUrl) {
            currentSubtitles = audioDataToPlay.subtitles || [];
            renderSubtitles(currentSubtitles);
            startPlayback(audioDataToPlay.audioUrl, startTime, startPercent);
        }

        preloadNextChapter(chapterId);
        setupMediaSession(chapterId);
    }

    // --- FETCH API VÀ STREAMING ---
    async function getAudioUrl(text, currentLoadingChapterId, isPreload = false) {
        // 1. Xác định controller cần abort
        if (isPreload) {
            if (preloadFetchController) preloadFetchController.abort();
            preloadFetchController = new AbortController();
        } else {
            if (playFetchController) playFetchController.abort();
            playFetchController = new AbortController();
        }

        const signal = isPreload ? preloadFetchController.signal : playFetchController.signal;
        const voice = els.voiceSelect ? els.voiceSelect.value : "vi-VN-NamMinhNeural";
        const speed = els.speedSelect ? parseFloat(els.speedSelect.value) : 1.0;

        try {
            const response = await fetch('/api/tts-live-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, voice, speed }),
                signal: signal
            });

            if (!response.ok) throw new Error('TTS API Error');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.trim()) continue;
                    const data = JSON.parse(line);

                    if (data.type === 'progress' && !isPreload) {
                        if (els.loadingText) els.loadingText.textContent = `Đang tải: ${data.val}%`;
                    }
                    else if (data.type === 'done') {
                        const blob = base64ToBlob(data.audio, data.mimeType);
                        return {
                            audioUrl: URL.createObjectURL(blob),
                            subtitles: data.subtitles || []
                        };
                    }
                    else if (data.type === 'error') throw new Error(data.msg);
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log(isPreload ? 'Hủy preload cũ...' : 'Hủy play cũ...');
            }
            throw e;
        } finally {
            if (isPreload && preloadFetchController && preloadFetchController.signal === signal) {
                preloadFetchController = null;
            } else if (!isPreload && playFetchController && playFetchController.signal === signal) {
                playFetchController = null;
            }
        }
    }

    function startPlayback(url, startTime = 0, startPercent = null) {
        // Fix Memory Leak: Revoke blob cũ
        if (audioPlayer.src && audioPlayer.src.startsWith('blob:') && audioPlayer.src !== url) {
            URL.revokeObjectURL(audioPlayer.src);
        }
        if (currentMetadataHandler) {
            audioPlayer.removeEventListener('loadedmetadata', currentMetadataHandler);
        }

        audioPlayer.src = url;
        currentMetadataHandler = () => {
            if (startPercent !== null) {
                audioPlayer.currentTime = startPercent * audioPlayer.duration;
            } else {
                audioPlayer.currentTime = startTime;
            }

            audioPlayer.play().then(() => {
                isPlaying = true;
                updatePlayButton();
                updateProgress();
            }).catch(e => {
                if (e.name !== 'AbortError') {
                    console.error("Autoplay prevented:", e);
                    // Có thể do iOS chặn -> Thử recover hoặc nhắc user
                }
                isPlaying = false;
                updatePlayButton();
            });
        };
        audioPlayer.addEventListener('loadedmetadata', currentMetadataHandler, { once: true });
    }

    // --- PLAY CONTROL SỬA ĐỔI ---
    function togglePlay() {
        if (isPlaying) {
            isPlaying = false;
            audioPlayer.pause();
            updatePlayButton();
        } else {
            // Kiểm tra trạng thái lỗi/rỗng trước khi play
            if (audioPlayer.error || !audioPlayer.src || audioPlayer.networkState === 3) {
                console.log("Source lỗi/rỗng -> Gọi Recover");
                recoverAndPlay();
                return;
            }

            if (currentChapterId) {
                // Thử Play bình thường
                const playPromise = audioPlayer.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            isPlaying = true;
                            updatePlayButton();
                        })
                        .catch(error => {
                            console.warn("Play thường thất bại -> Gọi Recover", error);
                            recoverAndPlay();
                        });
                }
            } else {
                showToast('Vui lòng chọn chương', 'warning');
            }
        }
    }

    function updatePlayButton() {
        if (!els.playBtn) return;
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
            const percent = currentTime / duration;

            if (els.waveformCanvas) drawWaveform(percent);
            if (els.currentTime) els.currentTime.textContent = formatTime(currentTime);

            if (currentSubtitles.length > 0) {
                const index = currentSubtitles.findIndex(sub =>
                    currentTime >= sub.start && currentTime < sub.end
                );
                if (index !== -1) highlightSubtitle(index);
            }
        }
    }

    function stopPlayback() {
        isPlaying = false;
        audioPlayer.pause();
        updatePlayButton();
    }

    async function preloadNextChapter(currentId) {
        const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
        const idx = sortedNums.indexOf(currentId);
        if (idx < sortedNums.length - 1) {
            const nextId = sortedNums[idx + 1];
            if (nextChapterId === nextId && nextChapterData) return;

            // FIX MEMORY LEAK: Revoke URL cũ
            if (nextChapterData && nextChapterData.audioUrl) {
                URL.revokeObjectURL(nextChapterData.audioUrl);
            }

            nextChapterId = nextId;
            const fullText = `Chương ${nextId}. ${currentChapters[nextId].title}. \n ${currentChapters[nextId].content}`;
            try {
                // isPreload = true
                nextChapterData = await getAudioUrl(fullText, nextId, true);
            } catch (e) {
                if (e.name !== 'AbortError') console.warn("Preload failed", e);
                nextChapterId = null;
                nextChapterData = null;
            }
        }
    }

    function nextChapter() {
        savedStartTime = 0;
        const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
        const idx = sortedNums.indexOf(currentChapterId);
        if (idx < sortedNums.length - 1) {
            playChapter(sortedNums[idx + 1]);
        } else {
            showToast('Đã hết truyện!', 'success');
            stopPlayback();
        }
    }

    function prevChapter() {
        savedStartTime = 0;
        const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
        const idx = sortedNums.indexOf(currentChapterId);
        if (idx > 0) {
            playChapter(sortedNums[idx - 1]);
        } else {
            showToast('Đây là chương đầu tiên', 'warning');
        }
    }

    // ==========================================================
    // 6. HELPER FUNCTIONS
    // ==========================================================
    function base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
    }
    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
    function showLoading(show) {
        if (els.loading) {
            if (show) els.loading.classList.add('active');
            else els.loading.classList.remove('active');
        }
    }
    function showToast(msg, type = 'info') {
        if (!els.toast) return;
        const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : '⚠️');
        els.toast.querySelector('.toast-icon').textContent = icon;
        els.toast.querySelector('.toast-message').textContent = msg;
        els.toast.classList.add('show');
        setTimeout(() => els.toast.classList.remove('show'), 2000);
    }

    // --- SETTINGS & STORAGE ---
    function saveProgress(force = false) {
        if (!currentStoryId || !currentChapterId) return;
        const timeToSave = (audioPlayer.duration && audioPlayer.currentTime > 0)
            ? audioPlayer.currentTime : savedStartTime;
        const state = {
            storyId: currentStoryId,
            chapterId: currentChapterId,
            currentTime: timeToSave,
            timestamp: Date.now()
        };
        try { localStorage.setItem('audioPlayerProgress', JSON.stringify(state)); } catch (e) { }
    }
    function saveSettings() {
        const settings = {
            voice: els.voiceSelect ? els.voiceSelect.value : null,
            speed: els.speedSelect ? els.speedSelect.value : null,
            showLyrics: els.subtitleContainer ? (els.subtitleContainer.style.display === 'block') : false
        };
        try { localStorage.setItem('audioPlayerSettings', JSON.stringify(settings)); } catch (e) { }
    }
    function loadSettings() {
        try {
            const saved = localStorage.getItem('audioPlayerSettings');
            if (!saved) return;
            const settings = JSON.parse(saved);
            if (settings.voice && els.voiceSelect) els.voiceSelect.value = settings.voice;
            if (settings.speed && els.speedSelect) els.speedSelect.value = settings.speed;
            if (typeof settings.showLyrics === 'boolean') {
                if (settings.showLyrics) {
                    if (els.subtitleContainer) els.subtitleContainer.style.display = 'block';
                    if (els.albumArt) els.albumArt.classList.add('hidden');
                    if (els.toggleLyricsBtn) els.toggleLyricsBtn.classList.add('active');
                } else {
                    if (els.subtitleContainer) els.subtitleContainer.style.display = 'none';
                    if (els.albumArt) els.albumArt.classList.remove('hidden');
                    if (els.toggleLyricsBtn) els.toggleLyricsBtn.classList.remove('active');
                }
            }
        } catch (e) { console.error("Load settings error:", e); }
    }
    async function loadProgress() {
        try {
            const saved = localStorage.getItem('audioPlayerProgress');
            if (!saved) return;
            const state = JSON.parse(saved);
            if (!state.storyId || !state.chapterId) return;
            els.storySelect.value = state.storyId;
            if (els.storySelect.value !== state.storyId) return;
            await loadStory(state.storyId);
            els.chapterSelect.value = state.chapterId;
            if (parseInt(els.chapterSelect.value) !== state.chapterId) return;
            currentChapterId = state.chapterId;
            if (currentChapters[currentChapterId]) {
                if (els.trackTitle) els.trackTitle.textContent = `Chương ${currentChapterId}: ${currentChapters[currentChapterId].title}`;
            }
            if (els.currentTime) els.currentTime.textContent = formatTime(state.currentTime);
            savedStartTime = state.currentTime;
            if (els.playBtn) els.playBtn.disabled = false;
            if (els.prevBtn) els.prevBtn.disabled = false;
            if (els.nextBtn) els.nextBtn.disabled = false;
            showToast('Khôi phục phiên nghe cũ (Bấm Play để nghe)', 'info');
        } catch (e) { console.error(e); }
    }

    // --- UI PHỤ (LYRICS, TIMER, WAVEFORM) ---
    function toggleLyricsView() {
        if (!els.subtitleContainer || !els.albumArt) return;
        const isLyricsVisible = els.subtitleContainer.style.display === 'block';
        if (isLyricsVisible) {
            els.subtitleContainer.style.display = 'none';
            els.albumArt.classList.remove('hidden');
            if (els.toggleLyricsBtn) els.toggleLyricsBtn.classList.remove('active');
        } else {
            els.albumArt.classList.add('hidden');
            els.subtitleContainer.style.display = 'block';
            if (els.toggleLyricsBtn) els.toggleLyricsBtn.classList.add('active');
            scrollToActiveLine();
        }
        saveSettings();
    }
    function renderSubtitles(subtitles) {
        if (!els.subtitleContainer) return;
        els.subtitleContainer.innerHTML = '';
        const pStart = document.createElement('div'); pStart.style.height = '100px';
        els.subtitleContainer.appendChild(pStart);
        subtitles.forEach((sub, index) => {
            const p = document.createElement('p');
            p.className = 'sub-line';
            p.textContent = sub.text;
            p.dataset.index = index;
            p.addEventListener('click', () => {
                if (audioPlayer.duration) {
                    audioPlayer.currentTime = sub.start;
                    updateProgress();
                }
            });
            els.subtitleContainer.appendChild(p);
        });
        const pEnd = document.createElement('div'); pEnd.style.height = '100px';
        els.subtitleContainer.appendChild(pEnd);
        activeSubtitleIndex = -1;
    }
    function highlightSubtitle(index) {
        if (index === activeSubtitleIndex || !els.subtitleContainer) return;
        activeSubtitleIndex = index;
        const lines = els.subtitleContainer.querySelectorAll('.sub-line');
        lines.forEach(l => l.classList.remove('active'));
        if (lines[index]) {
            lines[index].classList.add('active');
            if (els.subtitleContainer.style.display === 'block') scrollToActiveLine();
        }
    }
    function scrollToActiveLine() {
        if (!els.subtitleContainer) return;
        const activeLine = els.subtitleContainer.querySelector('.sub-line.active');
        if (activeLine) activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function setupMediaSession(chapterId) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: `Chương ${chapterId}: ${currentChapters[chapterId].title}`,
                artist: els.storySelect.options[els.storySelect.selectedIndex].text,
                album: 'Truyện TTS',
                artwork: [{ src: 'icon/favico.png', sizes: '512x512', type: 'image/png' }]
            });
            navigator.mediaSession.setActionHandler('play', togglePlay);
            navigator.mediaSession.setActionHandler('pause', togglePlay);
            navigator.mediaSession.setActionHandler('previoustrack', prevChapter);
            navigator.mediaSession.setActionHandler('nexttrack', nextChapter);
        }
    }

    function setupTimerUI() {
        if (!els.sleepTimerBtn) return;
        els.sleepTimerBtn.addEventListener('click', () => els.sleepTimerModal.style.display = 'flex');
        els.closeTimerModal.addEventListener('click', () => els.sleepTimerModal.style.display = 'none');
        els.timerOpts.forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.val;
                if (val === 'off') {
                    stopAtEndOfChapter = false; sleepTimerEnd = null;
                    els.sleepTimerLabel.textContent = 'Hẹn giờ'; els.sleepTimerLabel.style.color = '';
                    showToast('Đã tắt hẹn giờ');
                } else if (val === 'end') {
                    stopAtEndOfChapter = true; sleepTimerEnd = null;
                    els.sleepTimerLabel.textContent = 'Hết chương'; els.sleepTimerLabel.style.color = 'var(--primary)';
                    showToast('Sẽ dừng khi hết chương');
                } else {
                    stopAtEndOfChapter = false; sleepTimerEnd = Date.now() + parseInt(val) * 60000;
                    els.sleepTimerLabel.style.color = 'var(--primary)';
                    showToast(`Hẹn giờ ${val} phút`);
                }
                els.sleepTimerModal.style.display = 'none';
            });
        });
    }
    function checkSleepTimer() {
        if (sleepTimerEnd) {
            const remaining = sleepTimerEnd - Date.now();
            if (remaining <= 0) {
                stopPlayback(); sleepTimerEnd = null; els.sleepTimerLabel.textContent = 'Hẹn giờ';
                showToast('Đã dừng phát (Hẹn giờ)');
            } else {
                els.sleepTimerLabel.textContent = `${Math.ceil(remaining / 60000)} phút`;
            }
        }
    }
    function onAudioEnded() {
        if (stopAtEndOfChapter) {
            stopPlayback(); stopAtEndOfChapter = false; els.sleepTimerLabel.textContent = 'Hẹn giờ';
            showToast('Đã dừng phát (Hết chương)');
        } else nextChapter();
    }

    function initWaveform() {
        generateFakeWaveform();
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }
    function generateFakeWaveform() {
        waveformData = [];
        for (let i = 0; i < BAR_COUNT; i++) {
            let h = Math.abs(Math.sin(i * 0.2) * 50) + Math.abs(Math.cos(i * 0.5) * 30) + (Math.random() * 20);
            waveformData.push(Math.max(10, Math.min(h, 90)));
        }
    }
    function resizeCanvas() {
        if (!els.waveformCanvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = els.progressContainer.getBoundingClientRect();
        els.waveformCanvas.width = rect.width * dpr;
        els.waveformCanvas.height = rect.height * dpr;
        els.waveformCanvas.getContext('2d').scale(dpr, dpr);
        drawWaveform(audioPlayer.duration ? audioPlayer.currentTime / audioPlayer.duration : 0);
    }
    function drawWaveform(progress) {
        if (!els.waveformCanvas) return;
        if (Math.abs(progress - lastDrawPercent) < 0.005) return;
        lastDrawPercent = progress;

        const ctx = els.waveformCanvas.getContext('2d');
        const width = els.waveformCanvas.width / (window.devicePixelRatio || 1);
        const height = els.waveformCanvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, width, height);

        const itemWidth = width / waveformData.length;
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#d946ef'); gradient.addColorStop(1, '#3b82f6');

        waveformData.forEach((hPercent, i) => {
            const x = i * itemWidth + itemWidth * 0.2;
            const h = (hPercent / 100) * (height * 0.8);
            const y = (height - h) / 2;
            const isPlayed = x < progress * width;

            ctx.lineCap = 'round';
            ctx.lineWidth = itemWidth * 0.6;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h);

            ctx.strokeStyle = isPlayed ? gradient : '#334155';
            ctx.shadowBlur = isPlayed ? 10 : 0;
            ctx.shadowColor = "rgba(139, 92, 246, 0.4)";
            ctx.stroke();
        });
    }

    init();
});