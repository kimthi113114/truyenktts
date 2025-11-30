document.addEventListener('DOMContentLoaded', () => {
    // ==========================================================
    // 1. KHỞI TẠO BIẾN TOÀN CỤC (STATE)
    // ==========================================================
    let currentStoryId = null;
    let currentChapterId = null;
    let currentChapters = {}; // { id: { title, content } }
    let isPlaying = false;
    let audioPlayer = new Audio();

    // Preload & Cache
    let nextChapterData = null;
    let nextChapterId = null;
    let currentMetadataHandler = null;

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

    // ==========================================================
    // 2. LẤY CÁC ELEMENT TỪ HTML (AN TOÀN)
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

        // UI Subtitle
        toggleLyricsBtn: document.getElementById('toggleLyricsBtn'),
        subtitleContainer: document.getElementById('subtitleContainer'),
        albumArt: document.getElementById('albumArt'),
        trackInfo: document.querySelector('.track-info'),

        // UI Khác
        waveformCanvas: document.getElementById('waveformCanvas'),
        currentTime: document.getElementById('currentTime'),
        totalTime: document.getElementById('totalTime'),
        voiceSelect: document.getElementById('voiceSelect'),
        speedSelect: document.getElementById('speedSelect'),
        loading: document.getElementById('loadingOverlay'),
        toast: document.getElementById('toast'),
        progressContainer: document.querySelector('.progress-container'),
        loadingText: document.getElementById('loadingText'),

        // Timer Elements
        sleepTimerBtn: document.getElementById('sleepTimerBtn'),
        sleepTimerLabel: document.getElementById('sleepTimerLabel'),
        sleepTimerModal: document.getElementById('sleepTimerModal'),
        closeTimerModal: document.getElementById('closeTimerModal'),
        timerOpts: document.querySelectorAll('.timer-opt')
    };

    // ==========================================================
    // 3. HÀM INIT (CHẠY ĐẦU TIÊN)
    // ==========================================================
    async function init() {
        // Kiểm tra tối thiểu: Nếu không có nút Play hoặc Select truyện thì dừng
        if (!els.playBtn || !els.storySelect) {
            console.error("Thiếu HTML quan trọng (playBtn hoặc storySelect). Kiểm tra lại file HTML.");
            return;
        }

        showLoading(true);
        try {
            // Tải danh sách truyện
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

            // Khôi phục tiến trình cũ
            await loadProgress();

        } catch (err) {
            showToast('Lỗi kết nối server', 'error');
            console.error(err);
        } finally {
            showLoading(false);
        }

        // --- GÁN SỰ KIỆN (EVENT LISTENERS) ---

        // 1. Controls cơ bản
        els.storySelect.addEventListener('change', (e) => loadStory(e.target.value));
        els.chapterSelect.addEventListener('change', (e) => {
            if (e.target.value) playChapter(parseInt(e.target.value));
        });

        els.playBtn.addEventListener('click', togglePlay);
        if (els.prevBtn) els.prevBtn.addEventListener('click', prevChapter);
        if (els.nextBtn) els.nextBtn.addEventListener('click', nextChapter);

        // 2. Lyrics Toggle
        if (els.toggleLyricsBtn) {
            els.toggleLyricsBtn.addEventListener('click', toggleLyricsView);
        }
        if (els.albumArt) {
            els.albumArt.addEventListener('click', toggleLyricsView);
        }

        // 3. Audio Events
        audioPlayer.addEventListener('timeupdate', updateProgress);
        audioPlayer.addEventListener('loadedmetadata', () => {
            if (els.totalTime) els.totalTime.textContent = formatTime(audioPlayer.duration);
        });
        audioPlayer.addEventListener('ended', onAudioEnded);
        audioPlayer.addEventListener('pause', () => saveProgress(true));
        audioPlayer.addEventListener('error', (e) => {
            console.error("Audio error", e);
            showToast('Lỗi phát audio', 'error');
            stopPlayback();
        });

        // 4. Seek (Tua)
        if (els.progressContainer) {
            els.progressContainer.addEventListener('click', (e) => {
                if (!audioPlayer.duration) return;
                const rect = els.progressContainer.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                audioPlayer.currentTime = percent * audioPlayer.duration;
                if (els.waveformCanvas) drawWaveform(percent);
            });
        }

        // 5. Setup Timer & Auto Save
        setupTimerUI();
        saveInterval = setInterval(() => {
            if (isPlaying) saveProgress();
            checkSleepTimer();
        }, 1000);

        // 6. Init Waveform
        if (els.waveformCanvas) initWaveform();

        // 7. Visibility Change (Fix lỗi UI khi mở lại tab)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && audioPlayer.duration) {
                updateProgress();
                updatePlayButton();
            }
        });

        // 8. Auto Save khi tắt tab
        window.addEventListener('beforeunload', () => saveProgress(true));
    }

    // ==========================================================
    // 4. LOGIC SUBTITLE / LYRICS
    // ==========================================================
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
    }

    function renderSubtitles(subtitles) {
        if (!els.subtitleContainer) return;
        els.subtitleContainer.innerHTML = '';

        // Padding trên dưới để dễ đọc
        const pStart = document.createElement('div'); pStart.style.height = '100px';
        els.subtitleContainer.appendChild(pStart);

        subtitles.forEach((sub, index) => {
            const p = document.createElement('p');
            p.className = 'sub-line';
            p.textContent = sub.text;
            p.dataset.index = index;
            p.addEventListener('click', () => {
                // Click vào dòng chữ để tua
                audioPlayer.currentTime = sub.start;
                updateProgress();
            });
            els.subtitleContainer.appendChild(p);
        });

        const pEnd = document.createElement('div'); pEnd.style.height = '100px';
        els.subtitleContainer.appendChild(pEnd);

        // Reset active index
        activeSubtitleIndex = -1;
    }

    function highlightSubtitle(index) {
        if (index === activeSubtitleIndex || !els.subtitleContainer) return;
        activeSubtitleIndex = index;

        const lines = els.subtitleContainer.querySelectorAll('.sub-line');
        lines.forEach(l => l.classList.remove('active'));

        if (lines[index]) {
            lines[index].classList.add('active');
            // Chỉ cuộn nếu đang mở tab lyrics
            if (els.subtitleContainer.style.display === 'block') {
                scrollToActiveLine();
            }
        }
    }

    function scrollToActiveLine() {
        if (!els.subtitleContainer) return;
        const activeLine = els.subtitleContainer.querySelector('.sub-line.active');
        if (activeLine) {
            activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        if (els.chapterSelect) els.chapterSelect.value = chapterId;
        if (els.trackTitle) els.trackTitle.textContent = `Chương ${chapterId}: ${currentChapters[chapterId].title}`;

        if (els.prevBtn) els.prevBtn.disabled = false;
        if (els.nextBtn) els.nextBtn.disabled = false;
        els.playBtn.disabled = false;

        // --- PRELOAD LOGIC ---
        if (nextChapterId === chapterId && nextChapterData && startTime === 0) {
            console.log("Sử dụng cache preload");
            currentSubtitles = nextChapterData.subtitles || [];
            renderSubtitles(currentSubtitles);
            startPlayback(nextChapterData.audioUrl);
            nextChapterData = null; // Clear cache
        } else {
            // Tải mới
            const fullText = `Chương ${chapterId}. ${currentChapters[chapterId].title}. \n ${currentChapters[chapterId].content}`;
            showLoading(true);
            try {
                const result = await getAudioUrl(fullText, chapterId);
                if (result && result.audioUrl) {
                    currentSubtitles = result.subtitles || [];
                    renderSubtitles(currentSubtitles);
                    startPlayback(result.audioUrl, startTime);
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

        preloadNextChapter(chapterId);
        setupMediaSession(chapterId);
    }

    // --- API CALL (TTS) ---
    async function getAudioUrl(text, currentLoadingChapterId) {
        const voice = els.voiceSelect ? els.voiceSelect.value : "vi-VN-NamMinhNeural";
        const speed = els.speedSelect ? parseFloat(els.speedSelect.value) : 1.0;

        const response = await fetch('/api/tts-live-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, voice, speed })
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
                try {
                    const data = JSON.parse(line);
                    if (data.type === 'progress') {
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
                } catch (e) {
                    console.error("JSON Error", e);
                }
            }
        }
    }

    // ==========================================================
    // 6. CÁC HÀM PHỤ TRỢ (HELPER)
    // ==========================================================

    function startPlayback(url, startTime = 0) {
        if (audioPlayer.src && audioPlayer.src.startsWith('blob:') && audioPlayer.src !== url) {
            URL.revokeObjectURL(audioPlayer.src);
        }
        if (currentMetadataHandler) {
            audioPlayer.removeEventListener('loadedmetadata', currentMetadataHandler);
        }

        audioPlayer.src = url;
        currentMetadataHandler = () => {
            audioPlayer.currentTime = startTime;
            audioPlayer.play().then(() => {
                isPlaying = true;
                updatePlayButton();
                updateProgress();
            }).catch(e => {
                if (e.name !== 'AbortError') console.error("Play failed", e);
            });
        };
        audioPlayer.addEventListener('loadedmetadata', currentMetadataHandler, { once: true });
        audioPlayer.load();
    }

    function togglePlay() {
        if (isPlaying) {
            isPlaying = false;
            audioPlayer.pause();
        } else {
            if (currentChapterId) {
                if (audioPlayer.src) {
                    audioPlayer.play();
                    isPlaying = true;
                } else {
                    playChapter(currentChapterId);
                }
            } else {
                showToast('Vui lòng chọn chương', 'warning');
            }
        }
        updatePlayButton();
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

            // Sync Subtitle
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
        if (els.waveformCanvas) drawWaveform(0);
        if (els.currentTime) els.currentTime.textContent = '0:00';
    }

    async function preloadNextChapter(currentId) {
        const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
        const idx = sortedNums.indexOf(currentId);
        if (idx < sortedNums.length - 1) {
            const nextId = sortedNums[idx + 1];
            if (nextChapterId === nextId && nextChapterData) return;

            if (nextChapterData && nextChapterData.audioUrl) URL.revokeObjectURL(nextChapterData.audioUrl);

            nextChapterId = nextId;
            const fullText = `Chương ${nextId}. ${currentChapters[nextId].title}. \n ${currentChapters[nextId].content}`;
            try {
                nextChapterData = await getAudioUrl(fullText, nextId);
            } catch (e) {
                console.warn("Preload failed", e);
                nextChapterId = null;
                nextChapterData = null;
            }
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

    function prevChapter() {
        const sortedNums = Object.keys(currentChapters).map(Number).sort((a, b) => a - b);
        const idx = sortedNums.indexOf(currentChapterId);
        if (idx > 0) {
            playChapter(sortedNums[idx - 1]);
        } else {
            showToast('Đây là chương đầu tiên', 'warning');
        }
    }

    // --- UTILS ---
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
        } catch (e) { }
    }

    async function loadProgress() {
        try {
            const saved = localStorage.getItem('audioPlayerProgress');
            if (!saved) return;
            const state = JSON.parse(saved);
            if (!state.storyId || !state.chapterId) return;

            els.storySelect.value = state.storyId;
            if (els.storySelect.value !== state.storyId) return; // Truyện không còn tồn tại

            await loadStory(state.storyId);

            els.chapterSelect.value = state.chapterId;
            if (parseInt(els.chapterSelect.value) !== state.chapterId) return;

            showToast('Khôi phục tiến trình...', 'info');
            await playChapter(state.chapterId, state.currentTime);
            togglePlay(); // Pause lại, đợi người dùng bấm Play
        } catch (e) { console.error(e); }
    }

    // --- MEDIA SESSION ---
    function setupMediaSession(chapterId) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: `Chương ${chapterId}: ${currentChapters[chapterId].title}`,
                artist: els.storySelect.options[els.storySelect.selectedIndex].text,
                album: 'Truyện KTTS',
                artwork: [{ src: 'icon/favico.png', sizes: '512x512', type: 'image/png' }]
            });
            navigator.mediaSession.setActionHandler('play', togglePlay);
            navigator.mediaSession.setActionHandler('pause', togglePlay);
            navigator.mediaSession.setActionHandler('previoustrack', prevChapter);
            navigator.mediaSession.setActionHandler('nexttrack', nextChapter);
        }
    }

    // --- TIMER UI ---
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

    // --- WAVEFORM ---
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

    // CHẠY INIT
    init();
});