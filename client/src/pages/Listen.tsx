import React, { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Typography, Drawer, Select, Space, message, Spin, Affix, Slider, Switch } from 'antd';
import {
    HomeOutlined,
    ReadOutlined,
    PlayCircleFilled,
    PauseCircleFilled,
    LeftOutlined,
    RightOutlined,
    SoundOutlined,
    SettingOutlined
} from '@ant-design/icons';
import './Listen.css';

const { Title, Text } = Typography;

interface Chapter {
    chapter: number;
    title: string;
}

const FONT_OPTIONS = [
    { value: 'Merriweather', label: 'Merriweather (Serif)' },
    { value: 'Roboto Slab', label: 'Roboto Slab (Serif)' },
    { value: 'Georgia', label: 'Georgia (Serif)' },
    { value: "'Seravek', 'Avenir Next', -apple-system, sans-serif", label: 'Seravek' },
    { value: 'Inter', label: 'Inter (Sans)' },
    { value: 'Outfit', label: 'Outfit (Sans)' },
    { value: 'system-ui', label: 'Hệ thống' },
];

const Listen: React.FC = () => {
    const { storyId, chapterId } = useParams<{ storyId: string, chapterId: string }>();
    const navigate = useNavigate();
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [currentChapter, setCurrentChapter] = useState<{ title: string, content: string } | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
    const [showLibrary, setShowLibrary] = useState(false);
    const [loading, setLoading] = useState(false);

    // Settings
    const [voice, setVoice] = useState(localStorage.getItem('voice') || 'vi-VN-NamMinhNeural');
    const [speed, setSpeed] = useState(parseFloat(localStorage.getItem('speed') || '1.0'));
    const [fontSize, setFontSize] = useState(parseInt(localStorage.getItem('fontSize') || '18'));
    const [fontFamily, setFontFamily] = useState(localStorage.getItem('fontFamily') || 'Merriweather');
    const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');
    const [showSettings, setShowSettings] = useState(false);

    // Controls bar visibility
    const [controlsVisible, setControlsVisible] = useState(true);
    const lastScrollY = useRef(0);
    const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const activeSentenceRef = useRef<HTMLDivElement>(null);

    // Initial Load
    useEffect(() => {
        if (storyId) {
            api.get(`/api/offline/story/${storyId}/chapters`)
                .then(data => setChapters(data.chapters || []));
        }
    }, [storyId]);

    useEffect(() => {
        if (storyId && chapterId) {
            setLoading(true);
            setIsPlaying(false);
            if (audioRef.current) audioRef.current.pause();

            api.get(`/api/offline/story/${storyId}/chapter/${chapterId}`)
                .then(data => {
                    setCurrentChapter(data);
                    setCurrentSentenceIndex(0);
                    setLoading(false);
                    saveProgress(storyId, chapterId);
                })
                .catch(() => {
                    message.error('Lỗi tải nội dung chương');
                    setLoading(false);
                });
        }
    }, [storyId, chapterId]);

    // Auto-scroll to active sentence
    useEffect(() => {
        if (activeSentenceRef.current && isPlaying) {
            activeSentenceRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
    }, [currentSentenceIndex, isPlaying]);

    // Scroll detection for controls bar
    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;

            // Clear existing timeout
            if (scrollTimeout.current) {
                clearTimeout(scrollTimeout.current);
            }

            // Determine scroll direction
            if (currentScrollY > lastScrollY.current + 10) {
                // Scrolling down - hide controls
                setControlsVisible(false);
            } else if (currentScrollY < lastScrollY.current - 10) {
                // Scrolling up - show controls
                setControlsVisible(true);
            }

            lastScrollY.current = currentScrollY;

            // Show controls after scroll stops
            scrollTimeout.current = setTimeout(() => {
                setControlsVisible(true);
            }, 1500);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', handleScroll);
            if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
        };
    }, []);

    // Sync dark mode to body for global Ant Design components
    useEffect(() => {
        if (darkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        return () => {
            document.body.classList.remove('dark-mode');
        };
    }, [darkMode]);

    const saveProgress = (sid: string, cid: string) => {
        const timestamp = Date.now();
        const newProgress = { chapterId: cid, timestamp };
        try {
            const localProgressStr = localStorage.getItem('readingProgress') || '{}';
            let localProgress = JSON.parse(localProgressStr);
            if (localProgress.storyId) localProgress = { [localProgress.storyId]: localProgress };
            localProgress[sid] = newProgress;
            localStorage.setItem('readingProgress', JSON.stringify(localProgress));
        } catch (e) { console.error(e); }
    };

    const sentences = currentChapter ? [
        `Chương ${chapterId}: ${currentChapter.title}`,
        ...currentChapter.content.split('\n').filter(s => s.trim())
    ] : [];

    const handlePlayPause = async () => {
        if (isPlaying) {
            setIsPlaying(false);
            audioRef.current?.pause();
        } else {
            setIsPlaying(true);
            if (!audioRef.current || audioRef.current.ended) {
                playSentence(currentSentenceIndex);
            } else {
                audioRef.current.play();
            }
        }
    };

    const playSentence = async (index: number) => {
        if (index >= sentences.length) {
            setIsPlaying(false);
            return;
        }

        setCurrentSentenceIndex(index);
        try {
            const data = await api.post('/api/tts-live', { text: sentences[index], voice, speed });
            const audioBlob = await (await fetch(`data:${data.mimeType};base64,${data.audio}`)).blob();
            const url = URL.createObjectURL(audioBlob);

            if (!audioRef.current) {
                audioRef.current = new Audio(url);
            } else {
                audioRef.current.src = url;
            }

            audioRef.current.onended = () => {
                playSentence(index + 1);
            };
            audioRef.current.play();
        } catch (err) {
            console.error(err);
            setIsPlaying(false);
            message.error('Lỗi TTS');
        }
    };

    const goToChapter = (num: number) => {
        navigate(`/listen/${storyId}/${num}`);
        setShowLibrary(false);
    };

    const settingsContent = (
        <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 20 }}>
                <Text strong>Giọng đọc</Text>
                <Select
                    value={voice}
                    onChange={v => { setVoice(v); localStorage.setItem('voice', v); }}
                    style={{ width: '100%', marginTop: 8 }}
                >
                    <Select.Option value="vi-VN-NamMinhNeural">Nam Minh (Nam)</Select.Option>
                    <Select.Option value="vi-VN-HoaiMyNeural">Hoài My (Nữ)</Select.Option>
                </Select>
            </div>
            <div style={{ marginBottom: 20 }}>
                <Text strong>Tốc độ: {speed}x</Text>
                <Slider
                    min={0.5} max={3.0} step={0.1}
                    value={speed}
                    onChange={v => { setSpeed(v); localStorage.setItem('speed', String(v)); }}
                />
            </div>
            <div style={{ marginBottom: 20 }}>
                <Text strong>Phông chữ</Text>
                <Select
                    value={fontFamily}
                    onChange={v => { setFontFamily(v); localStorage.setItem('fontFamily', v); }}
                    style={{ width: '100%', marginTop: 8 }}
                >
                    {FONT_OPTIONS.map(f => (
                        <Select.Option key={f.value} value={f.value}>
                            <span style={{ fontFamily: f.value }}>{f.label}</span>
                        </Select.Option>
                    ))}
                </Select>
            </div>
            <div style={{ marginBottom: 20 }}>
                <Text strong>Cỡ chữ: {fontSize}px</Text>
                <Slider min={14} max={32} value={fontSize} onChange={v => { setFontSize(v); localStorage.setItem('fontSize', String(v)); }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>Chế độ tối</Text>
                <Switch checked={darkMode} onChange={v => { setDarkMode(v); localStorage.setItem('darkMode', String(v)); }} />
            </div>
        </div>
    );

    return (
        <div className={`listen-layout ${darkMode ? 'dark-mode' : ''}`}>
            <Affix offsetTop={0}>
                <div className="listen-header">
                    <Space>
                        <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/')} />
                        <Title level={5} style={{ margin: 0, maxWidth: 200, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                            {currentChapter ? `Chương ${chapterId}` : 'Loading...'}
                        </Title>
                    </Space>
                    <Space>
                        <Button icon={<ReadOutlined />} onClick={() => setShowLibrary(true)}>Chương</Button>
                        <Button icon={<SettingOutlined />} onClick={() => setShowSettings(true)} />
                        <Button type="primary" ghost icon={<SoundOutlined />} onClick={() => navigate(`/audio/${storyId}/${chapterId}`)}>
                            Player
                        </Button>
                    </Space>
                </div>
            </Affix>

            <div className="reading-container" ref={contentRef}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" tip="Đang tải nội dung..." /></div>
                ) : (
                    currentChapter ? (
                        <>
                            <h1 className="chapter-title" style={{ fontSize: fontSize * 1.5, fontFamily }}>{currentChapter.title}</h1>
                            <div className="reading-text" style={{ fontSize, fontFamily }}>
                                {sentences.slice(1).map((sentence, idx) => (
                                    <div
                                        key={idx}
                                        ref={(idx + 1) === currentSentenceIndex ? activeSentenceRef : null}
                                        className={`sentence-wrapper ${(idx + 1) === currentSentenceIndex ? 'active' : ''}`}
                                        onClick={() => {
                                            setCurrentSentenceIndex(idx + 1);
                                            if (isPlaying) playSentence(idx + 1);
                                        }}
                                    >
                                        {sentence}
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div style={{ textAlign: 'center', marginTop: 100 }}>
                            <Text type="secondary">Không tìm thấy nội dung hoặc đang tải...</Text>
                        </div>
                    )
                )}
            </div>

            {/* Floating Controls Bar */}
            <div className={`controls-bar ${controlsVisible ? '' : 'hidden'}`}>
                <div className="controls-main-row">
                    <Button
                        type="text"
                        icon={<LeftOutlined />}
                        disabled={Number(chapterId) <= 1}
                        onClick={() => goToChapter(Number(chapterId) - 1)}
                    >
                        Trước
                    </Button>

                    <div className="controls-center">
                        <div className="play-button-wrapper" onClick={handlePlayPause}>
                            {isPlaying ? <PauseCircleFilled style={{ color: 'white', fontSize: 28 }} /> : <PlayCircleFilled style={{ color: 'white', fontSize: 28 }} />}
                        </div>
                    </div>

                    <Button
                        type="text"
                        icon={<RightOutlined />}
                        onClick={() => goToChapter(Number(chapterId) + 1)}
                        style={{ flexDirection: 'row-reverse' }}
                    >
                        Sau
                    </Button>
                </div>
                <Drawer
                    title="Danh sách chương"
                    placement="right"
                    width={320}
                    onClose={() => setShowLibrary(false)}
                    open={showLibrary}
                    bodyStyle={{ padding: 0 }}
                >
                    <div>
                        {chapters.map(ch => (
                            <div
                                key={ch.chapter}
                                onClick={() => goToChapter(ch.chapter)}
                                style={{
                                    padding: '12px 24px',
                                    borderBottom: '1px solid #f0f0f0',
                                    cursor: 'pointer',
                                    background: Number(chapterId) === ch.chapter ? '#e6f7ff' : 'transparent',
                                    color: Number(chapterId) === ch.chapter ? '#1677ff' : 'inherit'
                                }}
                            >
                                <div style={{ fontWeight: 600 }}>Chương {ch.chapter}</div>
                                <div style={{ fontSize: '0.9em', color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.title}</div>
                            </div>
                        ))}
                    </div>
                </Drawer>

                {/* Settings Drawer */}
                <Drawer
                    title="Cài đặt"
                    placement="top"
                    height="auto"
                    onClose={() => setShowSettings(false)}
                    open={showSettings}
                    styles={{ body: { padding: '16px 24px' } }}
                >
                    {settingsContent}
                </Drawer>
            </div>


        </div>
    );
};

export default Listen;
