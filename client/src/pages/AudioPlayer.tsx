import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useParams, useNavigate } from 'react-router-dom';
import {
    LeftOutlined,
    ReadOutlined,
    BackwardOutlined,
    ForwardOutlined,
    PlayCircleFilled,
    PauseCircleFilled,
    CustomerServiceOutlined,
    ClockCircleOutlined,
    GlobalOutlined,
    SoundOutlined
} from '@ant-design/icons';
import { message, Slider } from 'antd';
import './AudioPlayer.css';

// Types
interface Chapter {
    chapter: number;
    title: string;
    content?: string[];
}

interface Story {
    id: string;
    title: string;
}

interface Subtitle {
    start: number;
    end: number;
    text: string;
}

const AudioPlayer: React.FC = () => {
    const { storyId: paramStoryId, chapterId: paramChapterId } = useParams();
    const navigate = useNavigate();

    // State
    const [stories, setStories] = useState<Story[]>([]);
    const [chapters, setChapters] = useState<Record<number, Chapter>>({});
    const [selectedStoryId] = useState<string>(paramStoryId || '');
    const [selectedChapterId, setSelectedChapterId] = useState<string>(paramChapterId || '');
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingText, setLoadingText] = useState('Đang tải...');
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [voice, setVoice] = useState('vi-VN-NamMinhNeural');
    const [speed, setSpeed] = useState(1.0);
    const [sleepTimer, setSleepTimer] = useState<number | 'end' | null>(null);
    const [showSleepModal, setShowSleepModal] = useState(false);
    const [showLyrics, setShowLyrics] = useState(false);

    // Refs
    const audioRef = useRef<HTMLAudioElement>(new Audio());
    const playFetchController = useRef<AbortController | null>(null);
    const preloadFetchController = useRef<AbortController | null>(null);
    const nextChapterData = useRef<{ audioUrl: string; subtitles: Subtitle[] } | null>(null);
    const nextChapterId = useRef<string | null>(null);
    const startAtRef = useRef(0);

    // Latest state refs for event listeners to avoid stale closures
    const stateRef = useRef({
        chapters,
        selectedChapterId,
        selectedStoryId,
        subtitles,
        currentTime,
        sleepTimer,
        stories,
        isPlaying,
        voice,
        speed
    });

    useEffect(() => {
        stateRef.current = {
            chapters,
            selectedChapterId,
            selectedStoryId,
            subtitles,
            currentTime,
            sleepTimer,
            stories,
            isPlaying,
            voice,
            speed
        };

        // Update Media Session state if needed (e.g. playback state)
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        }
    }, [chapters, selectedChapterId, selectedStoryId, subtitles, currentTime, sleepTimer, stories, isPlaying, voice, speed]);

    // Helper: Toast
    const toast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
        if (type === 'success') message.success(msg);
        else if (type === 'error') message.error(msg);
        else message.info(msg);
    };

    // Helper: Time Format
    const formatTime = (seconds: number) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    // Initial Load
    useEffect(() => {
        // Load stories
        api.get('/api/stories-listen')
            .then(data => setStories(data))
            .catch(console.error);

        // Load settings
        const savedCollapsed = localStorage.getItem('controlsCollapsed') === 'true';
        setIsCollapsed(savedCollapsed);

        // Load settings: speed, voice
        const savedSpeed = localStorage.getItem('audioPlayerSpeed');
        if (savedSpeed) setSpeed(parseFloat(savedSpeed));

        const savedVoice = localStorage.getItem('audioPlayerVoice');
        if (savedVoice) setVoice(savedVoice);

        // Lock Body Scroll
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    // Load Chapters when Story Changes
    useEffect(() => {
        if (!selectedStoryId) return;

        setLoading(true);
        api.get(`/api/offline/story/${selectedStoryId}/chapters`)
            .then(data => {
                const newChapters: Record<number, Chapter> = {};
                if (data.chapters) {
                    data.chapters.forEach((c: any) => {
                        newChapters[c.chapter] = { title: c.title, chapter: c.chapter };
                    });
                }
                setChapters(newChapters);
                // Update ref immediately for playChapter calls
                stateRef.current.chapters = newChapters;

                // Check saved progress
                const saved = localStorage.getItem('audioPlayerProgress');
                let savedState: any = null;
                if (saved) {
                    try {
                        savedState = JSON.parse(saved);
                    } catch (e) { }
                }

                if (paramChapterId && newChapters[Number(paramChapterId)]) {
                    // Navigate to specific chapter
                    const savedTime = (savedState && savedState.storyId === selectedStoryId && String(savedState.chapterId) === paramChapterId)
                        ? savedState.currentTime
                        : 0;

                    if (savedTime > 0) {
                        setSelectedChapterId(paramChapterId);
                        setCurrentTime(savedTime);
                        startAtRef.current = savedTime;
                    } else {
                        // Direct link, just select it. Wait for play.
                        setSelectedChapterId(paramChapterId);
                        // We could call playChapter(..., 0, false) to pre-fetch, but "lazy" means wait.
                        // However, if we don't fetch, we don't have duration. 
                        // Let's stick to pure lazy: just select. 
                        // But we need to ensure playChapter is called on togglePlay.
                    }
                } else if (!paramChapterId && savedState && savedState.storyId === selectedStoryId && newChapters[savedState.chapterId]) {
                    // Resume last session LAZY
                    setSelectedChapterId(String(savedState.chapterId));
                    setCurrentTime(savedState.currentTime);
                    startAtRef.current = savedState.currentTime;
                } else if (!paramChapterId) {
                    // Default to first chapter if nothing requested
                    const firstChap = Object.keys(newChapters).map(Number).sort((a, b) => a - b)[0];
                    if (firstChap) setSelectedChapterId(String(firstChap));
                }
            })
            .catch(() => toast('Lỗi tải truyện', 'error'))
            .finally(() => setLoading(false));
    }, [selectedStoryId]);


    // Audio Event Listeners
    useEffect(() => {
        const audio = audioRef.current;
        audio.preload = 'none';

        const onTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
        };

        const onLoadedMetadata = () => {
            setDuration(audio.duration);
        };

        const onEnded = () => {
            setIsPlaying(false);
            const { sleepTimer } = stateRef.current;
            if (sleepTimer === 'end') {
                setSleepTimer(null);
                setLoading(false);
                return;
            }
            setCurrentTime(0);
            handleNextChapter();
        };

        const onError = (e: any) => {
            console.error("Audio Error", e);
            if (audio.error && audio.error.code !== 20) {
                setIsPlaying(false);
                toast('Lỗi phát âm thanh', 'error');
            }
        };

        const onPause = () => setIsPlaying(false);
        const onPlay = () => setIsPlaying(true);

        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('loadedmetadata', onLoadedMetadata);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('error', onError);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('play', onPlay);

        return () => {
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('error', onError);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('play', onPlay);
            if (audio.src && audio.src.startsWith('blob:')) {
                URL.revokeObjectURL(audio.src);
            }
        };
    }, []); // Empty dependency array = bound once. Handlers use stateRef.

    // Save Progress Interval
    useEffect(() => {
        const interval = setInterval(() => {
            if (isPlaying && selectedStoryId && selectedChapterId) {
                const progress = {
                    storyId: selectedStoryId,
                    chapterId: Number(selectedChapterId),
                    currentTime: audioRef.current.currentTime,
                    timestamp: Date.now()
                };
                localStorage.setItem('audioPlayerProgress', JSON.stringify(progress));
            }
            // Sleep timer countdown logic could go here
            if (sleepTimer && typeof sleepTimer === 'number') {
                // If we were implementing a real countdown, we'd decrement here.
                // For now, simpler implementation: just check in onEnded or use a strict timeout.
                // But strict timeout resets on pause/play.
                // Let's stick to "Sleep in X mins" meaning "Stop playing after X mins form NOW".
                // But the user UI suggests "15 min", etc. Usually this means a timeout that fires once.
                // We'll actually implement the timeout logic when setting the timer.
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [isPlaying, selectedStoryId, selectedChapterId, sleepTimer]);

    // Sleep Timer Timeout Logic
    useEffect(() => {
        let timerId: any;
        if (typeof sleepTimer === 'number') {
            if (sleepTimer <= 0) {
                // Time's up
                if (!audioRef.current.paused) {
                    audioRef.current.pause();
                    setIsPlaying(false);
                    toast('Đã dừng phát theo hẹn giờ', 'info');
                }
                setSleepTimer(null);
                return;
            }

            // Countdown every minute
            timerId = setTimeout(() => {
                setSleepTimer(t => (typeof t === 'number' ? t - 1 : t));
            }, 60000);
        }
        return () => clearTimeout(timerId);
    }, [sleepTimer]);





    // Play Logic
    const playChapter = async (chapterId: string, startTime = 0, autoPlay = true, voiceOverride?: string) => {
        // Use stateRef to ensure we have value even if called from stale closure (e.g. onEnded)
        const { selectedStoryId, chapters, speed } = stateRef.current;

        if (!selectedStoryId || !chapters[Number(chapterId)]) return;

        setSelectedChapterId(chapterId);
        setLoadingProgress(0);
        navigate(`/audio/${selectedStoryId}/${chapterId}`, { replace: true });

        // --- IOS Hack ---
        if (autoPlay) audioRef.current.load();

        try {
            setLoading(true);
            setLoadingText('Đang tải dữ liệu...');

            let audioData: { audioUrl: string; subtitles: Subtitle[] } | null = null;

            // Check preload
            if (nextChapterId.current === chapterId && nextChapterData.current && !voiceOverride) {
                console.log("Using preloaded data");
                audioData = nextChapterData.current;
                nextChapterData.current = null;
                nextChapterId.current = null;
            } else {
                // Fetch Content
                setLoadingText(`Đang tải nội dung...`);
                const content = await fetchContent(selectedStoryId, chapterId);
                if (!content) throw new Error("Content load failed");

                const fullText = `Chương ${chapterId}. ${chapters[Number(chapterId)].title}. \n ${content}`;

                // Fetch Audio
                setLoadingText('Đang kết nối server...');
                audioData = await getAudioUrl(fullText, false, voiceOverride);
            }

            if (audioData) {
                setSubtitles(audioData.subtitles);

                // Revoke old
                if (audioRef.current.src && audioRef.current.src.startsWith('blob:')) {
                    URL.revokeObjectURL(audioRef.current.src);
                }

                audioRef.current.src = audioData.audioUrl;
                audioRef.current.currentTime = startTime;
                audioRef.current.playbackRate = speed;

                if (autoPlay) {
                    try {
                        await audioRef.current.play();
                        setIsPlaying(true);
                    } catch (e) {
                        console.error("Autoplay failed", e);
                        setIsPlaying(false);
                    }
                }

                setupMediaSession(chapterId);

                // Sync progress
                const syncPayload = {
                    key: "kimthi",
                    data: {
                        [selectedStoryId]: {
                            chapterId: Number(chapterId),
                            sentenceIndex: 0,
                            audio: false,
                            timestamp: Date.now()
                        }
                    }
                };
                api.post('/api/sync/save', syncPayload)
                    .then(() => message.success('Đã lưu tiến độ nghe'))
                    .catch(console.error);

                // Trigger preload next
                preloadNextChapter(chapterId);
            }
        } catch (error) {
            console.error(error);
            // Error handling is mostly done inside helpers, but we ensure loading is off
        } finally {
            setLoading(false);
        }
    };

    // SETUP MEDIA SESSION
    const setupMediaSession = (chapterId: string) => {
        if ('mediaSession' in navigator) {
            const { chapters } = stateRef.current;
            const chap = chapters[Number(chapterId)];
            const title = chap?.title;
            navigator.mediaSession.metadata = new MediaMetadata({
                title: `Chương ${chapterId}`,
                artist: title ? title : 'Truyện KTTS',
                album: 'Truyện KTTS',
                artwork: [
                    { src: '/icon/favico.png', sizes: '512x512', type: 'image/png' }
                ]
            });

            navigator.mediaSession.setActionHandler('play', () => {
                audioRef.current.play();
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                audioRef.current.pause();
            });

            navigator.mediaSession.setActionHandler('previoustrack', () => {
                handlePrevSentence();
            });
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                handleNextSentence();
            });
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.seekTime && duration) {
                    audioRef.current.currentTime = details.seekTime;
                }
            });
        }
    };

    // Helper to get content
    // Helper to get content
    const fetchContent = async (sid: string, cid: string) => {
        const { chapters } = stateRef.current;
        if (chapters[Number(cid)]?.content) return chapters[Number(cid)].content?.join('\n');

        // setLoading(true); // Handled in playChapter
        try {
            const data = await api.get(`/api/offline/story/${sid}/chapter/${cid}`);
            return data.content;
        } catch (e) {
            toast('Lỗi tải nội dung', 'error');
            return null;
        } finally {
            // setLoading(false); 
        }
    };

    // TTS Stream
    const getAudioUrl = async (text: string, isPreload: boolean, voiceOverride?: string): Promise<{ audioUrl: string; subtitles: Subtitle[] } | null> => {
        if (isPreload) {
            if (preloadFetchController.current) preloadFetchController.current.abort();
            preloadFetchController.current = new AbortController();
        } else {
            if (playFetchController.current) playFetchController.current.abort();
            playFetchController.current = new AbortController();
        }

        const signal = isPreload ? preloadFetchController.current!.signal : playFetchController.current!.signal;

        // Use stateRef
        const { voice, speed } = stateRef.current;

        try {
            const response = await fetch(api.getUrl('/api/tts-live-stream'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voice: voiceOverride || voice }),
                signal
            });

            if (!response.ok) throw new Error("TTS Error");

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No reader");

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.type === 'progress' && !isPreload) {
                            setLoadingText(`Đang tải...`);
                            setLoadingProgress(data.val || 0);
                        } else if (data.type === 'done') {
                            const binary = atob(data.audio);
                            const array = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
                            const blob = new Blob([array], { type: data.mimeType });
                            return {
                                audioUrl: URL.createObjectURL(blob),
                                subtitles: data.subtitles || []
                            };
                        }
                    } catch (e) { console.error("Parse error", e); }
                }
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') console.error(e);
        }
        return null;
    };

    const preloadNextChapter = async (currentCid: string) => {
        const { chapters, selectedStoryId } = stateRef.current;
        message.loading({ content: `Đang tải Chương ${currentCid}...`, key: 'loading_chapter', duration: 0 });
        try {
            const cids = Object.keys(chapters).map(Number).sort((a, b) => a - b);
            const idx = cids.indexOf(Number(currentCid));
            if (idx === -1 || idx === cids.length - 1) return;

            const nextCid = String(cids[idx + 1]);
            if (nextChapterId.current === nextCid) return;

            console.log("Preloading next:", nextCid);
            const content = await fetchContent(selectedStoryId, nextCid);
            if (!content) return;

            const fullText = `Chương ${nextCid}. ${chapters[Number(nextCid)].title}. \n ${content}`;
            const result = await getAudioUrl(fullText, true);
            if (result) {
                if (nextChapterData.current?.audioUrl) URL.revokeObjectURL(nextChapterData.current.audioUrl);
                nextChapterData.current = result;
                nextChapterId.current = nextCid;
                console.log("Preload success");
                // toast('Đã tải chương tiếp theo', 'success');
            }
        } finally {
            message.success({ content: `Đã tải Chương ${currentCid}`, key: 'loading_chapter', duration: 1 });
            // message.destroy('loading_chapter');
        }

    };


    const handleNextSentence = () => {
        // USE LATEST STATE via ref
        const { subtitles, currentTime } = stateRef.current;

        // Find current subtitle index
        const currentIndex = subtitles.findIndex((sub, i) => {
            const next = subtitles[i + 1];
            return currentTime >= sub.start && (!next || currentTime < next.start);
        });

        if (currentIndex !== -1 && currentIndex < subtitles.length - 1) {
            // Go to next sentence
            audioRef.current.currentTime = subtitles[currentIndex + 1].start;
        } else {
            // If at last sentence or no subtitles, go to next chapter
            handleNextChapter();
        }
    };

    const handlePrevSentence = () => {
        // USE LATEST STATE via ref
        const { subtitles, currentTime } = stateRef.current;

        const currentIndex = subtitles.findIndex((sub, i) => {
            const next = subtitles[i + 1];
            return currentTime >= sub.start && (!next || currentTime < next.start);
        });

        if (currentIndex > 0) {
            // If we are more than 2 seconds into the current sentence, replay it.
            // Otherwise, go to previous sentence.
            if (currentTime - subtitles[currentIndex].start > 2) {
                audioRef.current.currentTime = subtitles[currentIndex].start;
            } else {
                audioRef.current.currentTime = subtitles[currentIndex - 1].start;
            }
        } else {
            // If at first sentence, go to previous chapter
            handlePrevChapter();
        }
    };

    // Kept for fallback/direct usage if needed
    const handleNextChapter = () => {
        // USE LATEST STATE via ref because this can be called from onEnded
        const { chapters, selectedChapterId } = stateRef.current;
        const cids = Object.keys(chapters).map(Number).sort((a, b) => a - b);
        const idx = cids.indexOf(Number(selectedChapterId));
        if (idx !== -1 && idx < cids.length - 1) {
            playChapter(String(cids[idx + 1]));
        } else {
            toast('Đã hết chương', 'info');
        }
    };

    const handlePrevChapter = () => {
        // USE LATEST STATE via ref
        const { chapters, selectedChapterId } = stateRef.current;
        const cids = Object.keys(chapters).map(Number).sort((a, b) => a - b);
        const idx = cids.indexOf(Number(selectedChapterId));
        if (idx > 0) {
            playChapter(String(cids[idx - 1]));
        }
    };

    const togglePlay = () => {
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            if (audioRef.current.src) {
                audioRef.current.play().catch(console.error);
            } else {
                const startAt = startAtRef.current;
                playChapter(selectedChapterId, startAt, true);
                startAtRef.current = 0;
            }
        }
    };

    const handleSliderChange = (value: number) => {
        if (!duration) return;
        audioRef.current.currentTime = value;
        setCurrentTime(value);
    };

    // Subtitle highlighting
    const activeSubIndex = subtitles.findIndex((sub, i) => {
        const next = subtitles[i + 1];
        return currentTime >= sub.start && (!next || currentTime < next.start);
    });

    const activeSubtitleRef = useRef<HTMLParagraphElement>(null);
    useEffect(() => {
        if (activeSubtitleRef.current && showLyrics) {
            activeSubtitleRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeSubIndex, showLyrics]);

    return (
        <div className="audio-player-body" style={{ overflow: 'hidden' }}>
            <div className={`audio-player-loading ${loading ? 'active' : ''}`}>
                <div className="loading-dots">
                    <div className="loading-dot"></div><div className="loading-dot"></div><div className="loading-dot"></div>
                </div>
                <span>{loadingText} {loadingProgress > 0 ? `${loadingProgress}%` : ''}</span>
            </div>

            <div className="audio-player-bg-mesh" />
            <div className="audio-player-bg-orb" />

            <div className="audio-player-container">
                {/* Header / Nav */}
                <div className="audio-player-header-row">
                    <button className="audio-player-btn-icon" onClick={() => navigate('/')} title="Quay lại">
                        <LeftOutlined style={{ fontSize: '18px' }} />
                    </button>

                    <div className="audio-player-header-title">
                        <h1 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px', margin: '0 auto' }}>
                            {stories.find(s => s.id === selectedStoryId)?.title || 'Truyện KTTS'}
                        </h1>
                        <p style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px', margin: '2px auto 0' }}>
                            {chapters[Number(selectedChapterId)]
                                ? `Chương ${selectedChapterId}: ${chapters[Number(selectedChapterId)].title}`
                                : 'PREMIUM PLAYER'}
                        </p>
                    </div>

                    <button className="audio-player-btn-icon" onClick={() => {
                        window.location.href = `/listen/${selectedStoryId}/${selectedChapterId}`;
                    }} title="Chế độ đọc">
                        <ReadOutlined style={{ fontSize: '18px' }} />
                    </button>
                </div>

                {/* Visual Area */}
                <div className={`audio-player-visual-area ${isCollapsed ? 'expanded' : ''}`}>
                    <div className={`audio-player-album-art ${isPlaying ? 'playing' : ''} ${showLyrics ? 'hidden' : ''}`} onClick={() => setShowLyrics(true)}>
                        <img src="/icon/favico.png" alt="Album Art" />
                    </div>

                    {/* Lyrics Overlay - Now a sibling to keep layout stable or overlay correctly */}
                    <div className={`audio-player-subtitle-container ${showLyrics ? 'visible' : ''}`}
                        onClick={() => setShowLyrics(false)}>
                        {subtitles.length > 0 ? subtitles.map((sub, i) => (
                            <p
                                key={i}
                                className={`audio-player-sub-line ${i === activeSubIndex ? 'active' : ''}`}
                                ref={i === activeSubIndex ? activeSubtitleRef : null}
                                onClick={(e) => { e.stopPropagation(); audioRef.current.currentTime = sub.start; }}
                            >
                                {sub.text}
                            </p>
                        )) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6 }}>
                                <SoundOutlined style={{ fontSize: '40px', marginBottom: '10px' }} />
                                <p>Chưa có lời thoại</p>
                            </div>
                        )}
                    </div>


                </div>

                {/* Controls Area */}
                <div className={`audio-player-controls-area ${isCollapsed ? 'collapsed' : ''}`}>
                    <div
                        className="audio-player-collapse-handle"
                        onClick={() => {
                            setIsCollapsed(!isCollapsed);
                            localStorage.setItem('controlsCollapsed', String(!isCollapsed));
                        }}
                    />

                    {/* Progress Bar */}
                    <div className="audio-player-slider-container" style={{ padding: '0 10px', marginBottom: '5px' }}>
                        <Slider
                            min={0}
                            max={duration || 100}
                            value={currentTime}
                            onChange={handleSliderChange}
                            disabled={loading}
                            tooltip={{ formatter: (value) => formatTime(value || 0) }}
                            trackStyle={{ background: 'linear-gradient(to right, #8b5cf6, #f472b6)', height: 6 }}
                            handleStyle={{ borderColor: '#f472b6', boxShadow: '0 0 0 2px rgba(244, 114, 182, 0.3)' }}
                            railStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.15)', height: 6 }}
                        />
                    </div>
                    <div className="audio-player-time-row">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>

                    {/* Main Controls */}
                    <div className="audio-player-playback-controls" style={{ opacity: loading ? 0.5 : 1, pointerEvents: loading ? 'none' : 'auto' }}>
                        <button className="audio-player-btn-control" onClick={handlePrevSentence} disabled={loading} title="Câu trước">
                            <BackwardOutlined style={{ fontSize: '24px' }} />
                        </button>

                        <button className={`audio-player-btn-play ${isPlaying ? 'playing' : ''}`} onClick={togglePlay} disabled={loading}>
                            {isPlaying ? (
                                <PauseCircleFilled style={{ fontSize: '72px' }} />
                            ) : (
                                <PlayCircleFilled style={{ fontSize: '72px' }} />
                            )}
                        </button>

                        <button className="audio-player-btn-control" onClick={handleNextSentence} disabled={loading} title="Câu tiếp theo">
                            <ForwardOutlined style={{ fontSize: '24px' }} />
                        </button>
                    </div>

                    {/* Selection Controls */}
                    <div className="audio-player-select-row">
                        <select
                            className="audio-player-select"
                            style={{ flex: 1 }}
                            value={selectedChapterId}
                            onChange={(e) => playChapter(e.target.value)}
                            disabled={!selectedStoryId || loading}
                        >
                            <option value="">Chọn Chương</option>
                            {Object.keys(chapters).map(Number).sort((a, b) => a - b).map(num => (
                                <option key={num} value={num}>Chương {num}: {chapters[num].title}</option>
                            ))}
                        </select>
                    </div>

                    {/* Extras Row */}
                    <div className="audio-player-extras-row" style={{ opacity: loading ? 0.5 : 1, pointerEvents: loading ? 'none' : 'auto' }}>
                        <button className={`audio-player-btn-extra ${showLyrics ? 'active' : ''}`} onClick={() => !loading && setShowLyrics(!showLyrics)} disabled={loading}>
                            <CustomerServiceOutlined />
                            Lời
                        </button>

                        <button className={`audio-player-btn-extra ${sleepTimer ? 'active' : ''}`} onClick={() => !loading && setShowSleepModal(true)} disabled={loading}>
                            <ClockCircleOutlined />
                            {sleepTimer ? (sleepTimer === 'end' ? 'Hết' : `${sleepTimer}p`) : 'Hẹn giờ'}
                        </button>

                        <div className="audio-player-btn-extra" style={{ padding: '0' }}>
                            <GlobalOutlined style={{ marginRight: '4px' }} />
                            <select
                                value={String(speed)}
                                disabled={loading}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setSpeed(val);
                                    localStorage.setItem('audioPlayerSpeed', String(val));
                                    if (audioRef.current) audioRef.current.playbackRate = val;
                                }}
                                style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', outline: 'none', cursor: loading ? 'not-allowed' : 'pointer', appearance: 'none', padding: '6px 10px 6px 0' }}
                            >
                                <option value="1">1.0x</option>
                                <option value="1.25">1.25x</option>
                                <option value="1.5">1.5x</option>
                                <option value="2">2.0x</option>
                            </select>
                        </div>

                        <div className="audio-player-btn-extra" style={{ padding: '0' }}>
                            <SoundOutlined style={{ marginRight: '4px' }} />
                            <select
                                value={voice}
                                disabled={loading}
                                onChange={(e) => {
                                    const newVoice = e.target.value;
                                    setVoice(newVoice);
                                    localStorage.setItem('audioPlayerVoice', newVoice);
                                    if (selectedChapterId) playChapter(selectedChapterId, audioRef.current.currentTime, true, newVoice);
                                }}
                                style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', outline: 'none', cursor: loading ? 'not-allowed' : 'pointer', appearance: 'none', padding: '6px 10px 6px 0', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                                <option value="vi-VN-NamMinhNeural">Minh</option>
                                <option value="vi-VN-HoaiMyNeural">My</option>
                                <option value="en-US-EmmaMultilingualNeural">Emma</option>
                                <option value="en-US-BrianMultilingualNeural">Brian</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal */}
            {showSleepModal && (
                <div className="audio-player-modal-backdrop" onClick={() => setShowSleepModal(false)}>
                    <div className="audio-player-modal-content" onClick={e => e.stopPropagation()}>
                        <h3 className="modal-title">Hẹn giờ tắt</h3>
                        <div className="timer-grid">
                            {[5, 15, 30, 60].map(m => (
                                <button key={m} className={`timer-btn ${sleepTimer === m ? 'active' : ''}`} onClick={() => { setSleepTimer(m); setShowSleepModal(false); }}>
                                    {m} phút
                                </button>
                            ))}
                            <button className={`timer-btn ${sleepTimer === 'end' ? 'active' : ''}`} style={{ gridColumn: 'span 2' }} onClick={() => { setSleepTimer('end'); setShowSleepModal(false); }}>
                                Hết chương này
                            </button>
                            {sleepTimer && (
                                <button className="timer-btn cancel" onClick={() => { setSleepTimer(null); setShowSleepModal(false); }}>
                                    Tắt hẹn giờ
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default AudioPlayer;
