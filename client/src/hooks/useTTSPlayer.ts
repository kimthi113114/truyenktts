import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { message } from "antd";
import { api } from "../services/api";

// Types
export interface Chapter {
    chapter: number;
    title: string;
    content?: string[];
}

export interface Story {
    id: string;
    title: string;
}

export interface Subtitle {
    start: number;
    end: number;
    text: string;
}

export const useTTSPlayer = () => {
    const { storyId: paramStoryId, chapterId: paramChapterId } = useParams();
    const navigate = useNavigate();

    // State
    const [stories, setStories] = useState<Story[]>([]);
    const [chapters, setChapters] = useState<Record<number, Chapter>>({});
    const [selectedStoryId] = useState<string>(paramStoryId || "");
    const [selectedChapterId, setSelectedChapterId] = useState<string>(
        paramChapterId || "",
    );
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingText, setLoadingText] = useState("Đang tải...");
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [voice, setVoice] = useState("vi-VN-NamMinhNeural");
    const [speed, setSpeed] = useState(1.0);
    const [sleepTimer, setSleepTimer] = useState<number | "end" | null>(null);

    // Refs
    const audioRef = useRef<HTMLAudioElement>(new Audio());
    const playFetchController = useRef<AbortController | null>(null);
    const preloadFetchController = useRef<AbortController | null>(null);
    const nextChapterData = useRef<{
        audioUrl: string;
        subtitles: Subtitle[];
    } | null>(null);
    const nextChapterId = useRef<string | null>(null);
    const startAtRef = useRef(0);

    // Latest state refs for event listeners
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
        speed,
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
            speed,
        };

        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
        }
    }, [
        chapters,
        selectedChapterId,
        selectedStoryId,
        subtitles,
        currentTime,
        sleepTimer,
        stories,
        isPlaying,
        voice,
        speed,
    ]);

    // Toast Helper
    const toast = (msg: string, type: "success" | "error" | "info" = "info") => {
        if (type === "success") message.success(msg);
        else if (type === "error") message.error(msg);
        else message.info(msg);
    };

    // Initial Load
    useEffect(() => {
        api
            .get("/api/stories-listen")
            .then((data) => setStories(data))
            .catch(console.error);

        const savedSpeed = localStorage.getItem("audioPlayerSpeed");
        if (savedSpeed) setSpeed(parseFloat(savedSpeed));

        const savedVoice = localStorage.getItem("audioPlayerVoice");
        if (savedVoice) setVoice(savedVoice);

        // Lock Body Scroll
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = "";
        };
    }, []);

    // Load Chapters
    useEffect(() => {
        if (!selectedStoryId) return;

        setLoading(true);
        api
            .get(`/api/offline/story/${selectedStoryId}/chapters`)
            .then((data) => {
                const newChapters: Record<number, Chapter> = {};
                if (data.chapters) {
                    data.chapters.forEach((c: any) => {
                        newChapters[c.chapter] = { title: c.title, chapter: c.chapter };
                    });
                }
                setChapters(newChapters);
                stateRef.current.chapters = newChapters;

                // Check saved progress
                const saved = localStorage.getItem("audioPlayerProgress");
                let savedState: any = null;
                if (saved) {
                    try {
                        savedState = JSON.parse(saved);
                    } catch (e) { }
                }

                if (paramChapterId && newChapters[Number(paramChapterId)]) {
                    const savedTime =
                        savedState &&
                            savedState.storyId === selectedStoryId &&
                            String(savedState.chapterId) === paramChapterId
                            ? savedState.currentTime
                            : 0;

                    if (savedTime > 0) {
                        setSelectedChapterId(paramChapterId);
                        setCurrentTime(savedTime);
                        startAtRef.current = savedTime;
                    } else {
                        setSelectedChapterId(paramChapterId);
                    }
                } else if (
                    !paramChapterId &&
                    savedState &&
                    savedState.storyId === selectedStoryId &&
                    newChapters[savedState.chapterId]
                ) {
                    setSelectedChapterId(String(savedState.chapterId));
                    setCurrentTime(savedState.currentTime);
                    startAtRef.current = savedState.currentTime;
                } else if (!paramChapterId) {
                    const firstChap = Object.keys(newChapters)
                        .map(Number)
                        .sort((a, b) => a - b)[0];
                    if (firstChap) setSelectedChapterId(String(firstChap));
                }
            })
            .catch(() => toast("Lỗi tải truyện", "error"))
            .finally(() => setLoading(false));
    }, [selectedStoryId, paramChapterId]);

    // Audio Logic
    const fetchContent = async (sid: string, cid: string) => {
        const { chapters } = stateRef.current;
        if (chapters[Number(cid)]?.content)
            return chapters[Number(cid)].content?.join("\n");

        try {
            const data = await api.get(`/api/offline/story/${sid}/chapter/${cid}`);
            return data.content;
        } catch (e) {
            toast("Lỗi tải nội dung", "error");
            return null;
        }
    };

    const getAudioUrl = async (
        text: string,
        isPreload: boolean,
        voiceOverride?: string,
    ): Promise<{ audioUrl: string; subtitles: Subtitle[] } | null> => {
        if (isPreload) {
            if (preloadFetchController.current)
                preloadFetchController.current.abort();
            preloadFetchController.current = new AbortController();
        } else {
            if (playFetchController.current) playFetchController.current.abort();
            playFetchController.current = new AbortController();
        }

        const signal = isPreload
            ? preloadFetchController.current!.signal
            : playFetchController.current!.signal;
        const { voice } = stateRef.current;

        try {
            const response = await fetch(api.getUrl("/api/tts-live-stream"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text, voice: voiceOverride || voice }),
                signal,
            });

            if (!response.ok) throw new Error("TTS Error");

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No reader");

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        if (data.type === "progress" && !isPreload) {
                            setLoadingText(`Đang tải...`);
                            setLoadingProgress(data.val || 0);
                        } else if (data.type === "done") {
                            const binary = atob(data.audio);
                            const array = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++)
                                array[i] = binary.charCodeAt(i);
                            const blob = new Blob([array], { type: data.mimeType });
                            return {
                                audioUrl: URL.createObjectURL(blob),
                                subtitles: data.subtitles || [],
                            };
                        }
                    } catch (e) {
                        console.error("Parse error", e);
                    }
                }
            }
        } catch (e: any) {
            if (e.name !== "AbortError") console.error(e);
        }
        return null;
    };

    const preloadNextChapter = async (currentCid: string) => {
        const { chapters, selectedStoryId } = stateRef.current;
        try {
            const cids = Object.keys(chapters)
                .map(Number)
                .sort((a, b) => a - b);
            const idx = cids.indexOf(Number(currentCid));
            if (idx === -1 || idx === cids.length - 1) return;

            const nextCid = String(cids[idx + 1]);
            if (nextChapterId.current === nextCid) return;

            message.loading({
                content: `Đang tải Chương ${nextCid}...`,
                key: "loading_chapter",
                duration: 0,
            });
            console.log("Preloading next:", nextCid);
            const content = await fetchContent(selectedStoryId, nextCid);
            if (!content) return;

            const fullText = `Chương ${nextCid}. ${chapters[Number(nextCid)].title}. \n ${content}`;
            const result = await getAudioUrl(fullText, true);
            if (result) {
                if (nextChapterData.current?.audioUrl)
                    URL.revokeObjectURL(nextChapterData.current.audioUrl);
                nextChapterData.current = result;
                nextChapterId.current = nextCid;
                console.log("Preload success");
            }
        } finally {
            message.success({
                content: `Đã tải Chương ${currentCid}`,
                key: "loading_chapter",
                duration: 0.5,
            });
        }
    };

    const handlePrevSentence = () => {
        const { subtitles, currentTime } = stateRef.current;
        const currentIndex = subtitles.findIndex((sub, i) => {
            const next = subtitles[i + 1];
            return currentTime >= sub.start && (!next || currentTime < next.start);
        });

        if (currentIndex > 0) {
            if (currentTime - subtitles[currentIndex].start > 2) {
                audioRef.current.currentTime = subtitles[currentIndex].start;
            } else {
                audioRef.current.currentTime = subtitles[currentIndex - 1].start;
            }
        } else {
            handlePrevChapter();
        }
    };

    const handleNextSentence = () => {
        const { subtitles, currentTime } = stateRef.current;
        const currentIndex = subtitles.findIndex((sub, i) => {
            const next = subtitles[i + 1];
            return currentTime >= sub.start && (!next || currentTime < next.start);
        });

        if (currentIndex !== -1 && currentIndex < subtitles.length - 1) {
            audioRef.current.currentTime = subtitles[currentIndex + 1].start;
        } else {
            handleNextChapter();
        }
    };

    const setupMediaSession = (chapterId: string) => {
        if ("mediaSession" in navigator) {
            const { chapters } = stateRef.current;
            const chap = chapters[Number(chapterId)];
            const title = chap?.title;
            navigator.mediaSession.metadata = new MediaMetadata({
                title: `Chương ${chapterId}`,
                artist: title ? title : "Truyện KTTS",
                album: "Truyện KTTS",
                artwork: [
                    { src: "/icon/favico.png", sizes: "512x512", type: "image/png" },
                ],
            });

            navigator.mediaSession.setActionHandler("play", () =>
                audioRef.current.play(),
            );
            navigator.mediaSession.setActionHandler("pause", () =>
                audioRef.current.pause(),
            );
            navigator.mediaSession.setActionHandler(
                "previoustrack",
                handlePrevSentence,
            );
            navigator.mediaSession.setActionHandler("nexttrack", handleNextSentence);
            navigator.mediaSession.setActionHandler("seekto", (details) => {
                if (details.seekTime && audioRef.current.duration) {
                    audioRef.current.currentTime = details.seekTime;
                }
            });
        }
    };

    const playChapter = async (
        chapterId: string,
        startTime = 0,
        autoPlay = true,
        voiceOverride?: string,
    ) => {
        const { selectedStoryId, chapters, speed } = stateRef.current;
        if (!selectedStoryId || !chapters[Number(chapterId)]) return;

        setSelectedChapterId(chapterId);
        setLoadingProgress(0);
        navigate(`/audio/${selectedStoryId}/${chapterId}`, { replace: true });

        if (autoPlay) audioRef.current.load();

        try {
            setLoading(true);
            setLoadingText("Đang tải dữ liệu...");

            let audioData: { audioUrl: string; subtitles: Subtitle[] } | null = null;

            if (
                nextChapterId.current === chapterId &&
                nextChapterData.current &&
                !voiceOverride
            ) {
                console.log("Using preloaded data");
                audioData = nextChapterData.current;
                nextChapterData.current = null;
                nextChapterId.current = null;
            } else {
                setLoadingText(`Đang tải nội dung...`);
                const content = await fetchContent(selectedStoryId, chapterId);
                if (!content) throw new Error("Content load failed");
                const fullText = `Chương ${chapterId}. ${chapters[Number(chapterId)].title}. \n ${content}`;
                setLoadingText("Đang kết nối server...");
                audioData = await getAudioUrl(fullText, false, voiceOverride);
            }

            if (audioData) {
                setSubtitles(audioData.subtitles);
                if (audioRef.current.src && audioRef.current.src.startsWith("blob:")) {
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
                api
                    .post("/api/sync/save", {
                        key: "kimthi",
                        data: {
                            [selectedStoryId]: {
                                chapterId: Number(chapterId),
                                sentenceIndex: 0,
                                audio: false,
                                timestamp: Date.now(),
                            },
                        },
                    })
                    .then(() => message.success("Đã lưu tiến độ nghe"))
                    .catch(console.error);

                preloadNextChapter(chapterId);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleNextChapter = () => {
        const { chapters, selectedChapterId } = stateRef.current;
        const cids = Object.keys(chapters)
            .map(Number)
            .sort((a, b) => a - b);
        const idx = cids.indexOf(Number(selectedChapterId));
        if (idx !== -1 && idx < cids.length - 1) {
            playChapter(String(cids[idx + 1]));
        } else {
            toast("Đã hết chương", "info");
        }
    };

    const handlePrevChapter = () => {
        const { chapters, selectedChapterId } = stateRef.current;
        const cids = Object.keys(chapters)
            .map(Number)
            .sort((a, b) => a - b);
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

    // Event Listeners
    useEffect(() => {
        const audio = audioRef.current;
        audio.preload = "none";

        const onTimeUpdate = () => setCurrentTime(audio.currentTime);
        const onLoadedMetadata = () => setDuration(audio.duration);
        const onEnded = () => {
            setIsPlaying(false);
            const { sleepTimer } = stateRef.current;
            if (sleepTimer === "end") {
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
                toast("Lỗi phát âm thanh", "error");
            }
        };

        const onPause = () => setIsPlaying(false);
        const onPlay = () => setIsPlaying(true);

        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("loadedmetadata", onLoadedMetadata);
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", onError);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("play", onPlay);

        return () => {
            audio.removeEventListener("timeupdate", onTimeUpdate);
            audio.removeEventListener("loadedmetadata", onLoadedMetadata);
            audio.removeEventListener("ended", onEnded);
            audio.removeEventListener("error", onError);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("play", onPlay);
            if (audio.src && audio.src.startsWith("blob:")) {
                URL.revokeObjectURL(audio.src);
            }
        };
    }, []);

    // Progress Interval
    useEffect(() => {
        const interval = setInterval(() => {
            if (isPlaying && selectedStoryId && selectedChapterId) {
                const progress = {
                    storyId: selectedStoryId,
                    chapterId: Number(selectedChapterId),
                    currentTime: audioRef.current.currentTime,
                    timestamp: Date.now(),
                };
                localStorage.setItem("audioPlayerProgress", JSON.stringify(progress));
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [isPlaying, selectedStoryId, selectedChapterId]);

    // Sleep Timer
    useEffect(() => {
        let timerId: any;
        if (typeof sleepTimer === "number") {
            if (sleepTimer <= 0) {
                if (!audioRef.current.paused) {
                    audioRef.current.pause();
                    setIsPlaying(false);
                    toast("Đã dừng phát theo hẹn giờ", "info");
                }
                setSleepTimer(null);
                return;
            }
            timerId = setTimeout(() => {
                setSleepTimer((t) => (typeof t === "number" ? t - 1 : t));
            }, 60000);
        }
        return () => clearTimeout(timerId);
    }, [sleepTimer]);

    return {
        stories,
        chapters,
        selectedStoryId,
        selectedChapterId,
        isPlaying,
        currentTime,
        duration,
        subtitles,
        loading,
        loadingText,
        loadingProgress,
        voice,
        speed,
        sleepTimer,
        audioRef,
        setVoice,
        setSpeed,
        setSleepTimer,
        setCurrentTime,
        playChapter,
        togglePlay,
        handleNextSentence,
        handlePrevSentence,
        handleNextChapter,
        handlePrevChapter,
    };
};
