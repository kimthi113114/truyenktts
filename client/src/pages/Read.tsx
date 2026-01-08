import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import _ from 'lodash';
import { useSwipeable } from 'react-swipeable';
import {
    Layout,
    Button,
    Slider,
    Drawer,
    Radio,
    Typography,
    ConfigProvider,
    Space,
    Divider,
    Progress,
    Segmented,
    message,
    Select,
    List,
    theme as antTheme
} from 'antd';
import {
    MenuOutlined,
    SettingOutlined,
    FontSizeOutlined,
    BgColorsOutlined,
    ReadOutlined,
    VerticalAlignMiddleOutlined,
    EllipsisOutlined,
    AudioOutlined,
    BookOutlined,
    FontColorsOutlined,
    ColumnWidthOutlined,
    LeftOutlined,
    RightOutlined,
    HomeOutlined
} from '@ant-design/icons';
import './Read.css';


const { Content, Header, Footer } = Layout;
const { Title, Paragraph, Text } = Typography;

// TypeScript interfaces
interface Chapter {
    chapter: number;
    title: string;
}

interface ChapterContent {
    title: string;
    content: string[];
}

const THEMES = {
    light: { name: 'Sáng' },
    dark: { name: 'Tối' },
    sepia: { name: 'Sepia' },
} as const;

type ThemeKey = keyof typeof THEMES;


const FONTS = [
    { label: 'Mặc định (Sans)', value: '"Inter", "Segoe UI", system-ui, sans-serif' },
    { label: 'Cổ điển (Serif)', value: 'Georgia, "Times New Roman", serif' },
    { label: 'Lập trình (Mono)', value: '"SFMono-Regular", Consolas, "Courier New", monospace' },
    { label: 'Viết tay (Cursive)', value: '"Comic Sans MS", "Apple Chancery", cursive' },
    { label: 'Seravek', value: "'Seravek', 'Avenir Next', -apple-system, sans-serif" },
];

const THEME_COLORS = {
    light: '#ffffff',
    dark: '#000000',
    sepia: '#f8f1e3',
} as const;

const Read = () => {
    const { storyId, chapterId } = useParams<{ storyId: string, chapterId: string }>();
    const navigate = useNavigate();

    // Load settings from localStorage or use defaults
    const [theme, setTheme] = useState<ThemeKey>(() => {
        const saved = localStorage.getItem('theme') as ThemeKey;
        if (saved && THEMES[saved]) return saved;
        return localStorage.getItem('darkMode') === 'true' ? 'dark' : 'light';
    });
    const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('fontSize') || '18'));
    const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('fontFamily') || FONTS[4].value);
    const [lineHeight, setLineHeight] = useState(() => parseFloat(localStorage.getItem('lineHeight') || '1.8'));
    const [contentWidth, setContentWidth] = useState(() => parseInt(localStorage.getItem('contentWidth') || '90'));
    const [readMode, setReadMode] = useState(() => localStorage.getItem('readMode') || 'scroll');
    const [isDrawerVisible, setIsDrawerVisible] = useState(false);
    const [isSettingsVisible, setIsSettingsVisible] = useState(false);
    const [readingProgress, setReadingProgress] = useState(0);
    const [isHidden, setIsHidden] = useState(false);

    // Story and Chapter data from API
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [currentChapter, setCurrentChapter] = useState<ChapterContent | null>(null);
    const [loading, setLoading] = useState(false);

    const [currentPage, setCurrentPage] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    const preloadedChapterRef = useRef<{ storyId: string; chapterId: string; data: ChapterContent } | null>(null);
    const nextChapterContentRef = useRef<{ title: string; content: string[] } | null>(null);
    const isPreloadingNextChapter = useRef(false);

    // Ref for scrolling to active chapter in drawer
    const activeChapterRef = useRef<HTMLDivElement>(null);

    // Ref just for initial scroll target
    const targetSentenceIndexRef = useRef(-1);

    // Timeout ref for debouncing scroll save
    const scrollTimeoutRef = useRef<any>(null);

    // Helper to find visible sentence
    const getVisibleSentenceIndex = () => {
        if (!currentChapter) return -1;

        if (readMode === 'page' && containerRef.current) {
            const container = containerRef.current;
            const cRect = container.getBoundingClientRect();
            // Horizontal check
            for (let i = 0; i < currentChapter.content.length; i++) {
                const element = document.getElementById(`para-${i}`);
                if (element) {
                    const pRect = element.getBoundingClientRect();
                    // Check if element is overlapping with the valid container area
                    if (pRect.right > cRect.left + 10 && pRect.left < cRect.right - 10) {
                        return i;
                    }
                }
            }
        } else {
            // Vertical check (Window)
            const viewportHeight = window.innerHeight;
            for (let i = 0; i < currentChapter.content.length; i++) {
                const element = document.getElementById(`para-${i}`);
                if (element) {
                    const rect = element.getBoundingClientRect();
                    // Return first element that is reasonably visible (top is positive and within view, or spans the top edge)
                    if ((rect.top >= 0 && rect.top < viewportHeight) || (rect.bottom > 0 && rect.top < 0)) {
                        return i;
                    }
                }
            }
        }
        return -1;
    };

    // Debounced save progress
    const debouncedSaveProgress = () => {
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

        scrollTimeoutRef.current = setTimeout(() => {
            if (storyId && chapterId) {
                const index = getVisibleSentenceIndex();
                if (index !== -1) {
                    saveProgress(storyId, chapterId, index);
                }
            }
        }, 1000);
    };

    // Load chapters, content, and sync progress
    useEffect(() => {
        if (!storyId) return;
        const abortController = new AbortController();

        // 1. Load chapters list (if not loaded or changed story)
        fetch(`/api/offline/story/${storyId}/chapters`, { signal: abortController.signal })
            .then(res => res.json())
            .then(data => setChapters(data.chapters || []))
            .catch(err => err.name !== 'AbortError' && console.error('Load chapters failed:', err));

        if (!chapterId) return;

        // 2. Load chapter content
        const loadContent = async () => {
            // Check if we have preloaded content for this chapter
            if (preloadedChapterRef.current && preloadedChapterRef.current.storyId === storyId && preloadedChapterRef.current.chapterId === chapterId) {
                const { data } = preloadedChapterRef.current;
                setCurrentChapter(data);
                preloadedChapterRef.current = null; // Clear after use
                setLoading(false);
                return;
            }

            setLoading(true);
            message.loading({ content: `Đang tải Chương ${chapterId}...`, key: 'loading_chapter', duration: 0 });

            try {
                const res = await fetch(`/api/offline/story/${storyId}/chapter/${chapterId}`, { signal: abortController.signal });
                const data = await res.json();
                const contentArray = data.content.split('\n').filter((s: string) => s.trim());
                contentArray.unshift(`Chương ${chapterId}: ${data.title}`);

                // Check for saved progress
                const savedProgressStr = localStorage.getItem('readingProgress') || '{}';
                const savedProgress = JSON.parse(savedProgressStr)[storyId];
                let startIndex = -1;
                if (savedProgress && String(savedProgress.chapterId) === String(chapterId)) {
                    startIndex = savedProgress.sentenceIndex || 0;
                }

                setCurrentChapter({ title: data.title, content: contentArray });
                targetSentenceIndexRef.current = startIndex;
                setLoading(false);
                message.destroy('loading_chapter');
                saveProgress(storyId, chapterId, startIndex);
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    message.error({ content: 'Lỗi tải nội dung chương', key: 'loading_chapter' });
                    setLoading(false);
                }
            }
        };

        loadContent();

        // 3. Sync to cloud (minimal delay or direct)
        const syncPayload = {
            key: "kimthi",
            data: {
                [storyId]: {
                    chapterId: Number(chapterId),
                    sentenceIndex: 0,
                    audio: false,
                    timestamp: Date.now()
                }
            }
        };
        fetch('/api/sync/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncPayload)
        }).catch(console.error);

        return () => {
            abortController.abort();
            message.destroy('loading_chapter');
        };
    }, [storyId, chapterId]);


    // Scroll to saved position after loading finishes
    useEffect(() => {
        if (!loading && currentChapter) {
            // Small timeout to Ensure DOM is painted
            setTimeout(() => {
                const targetIndex = targetSentenceIndexRef.current;
                if (targetIndex !== -1) {
                    const element = document.getElementById(`para-${targetIndex}`);
                    if (element) {
                        element.scrollIntoView({ behavior: 'auto', block: 'center' });
                    }
                }
            }, 300); // 300ms to be safe
        }
    }, [loading, currentChapter]);

    // Save all settings to localStorage in a single effect (EXCEPT THEME SYNC)
    useEffect(() => {
        localStorage.setItem('theme', theme);
        localStorage.setItem('fontSize', String(fontSize));
        localStorage.setItem('fontFamily', fontFamily);
        localStorage.setItem('lineHeight', String(lineHeight));
        localStorage.setItem('contentWidth', String(contentWidth));
        localStorage.setItem('readMode', readMode);

        // Update body class for global theme background
        document.body.className = `theme-${theme}`;

        // Also sync darkMode for Listen.tsx compatibility
        if (theme === 'dark') {
            localStorage.setItem('darkMode', 'true');
        } else if (theme === 'light') {
            localStorage.setItem('darkMode', 'false');
        }
    }, [theme, fontSize, fontFamily, lineHeight, contentWidth, readMode]);

    // Dedicated Effect for iOS Safari Theme Color Sync
    // This runs ONLY when 'theme' changes to ensure immediate update
    useEffect(() => {
        const color = THEME_COLORS[theme];

        // 1. Force background colors
        document.body.style.backgroundColor = color;
        document.documentElement.style.backgroundColor = color;

        // 2. Force meta tag update (Remove & Re-add technique for Safari)
        const metaName = 'theme-color';
        let metaTag = document.querySelector(`meta[name="${metaName}"]`);

        // Try simple update first
        if (metaTag) {
            metaTag.setAttribute('content', color);
        } else {
            const newMeta = document.createElement('meta');
            newMeta.setAttribute('name', metaName);
            newMeta.setAttribute('content', color);
            document.head.appendChild(newMeta);
        }
    }, [theme]);

    // Auto-scroll to active chapter when drawer opens
    useEffect(() => {
        if (isDrawerVisible && activeChapterRef.current) {
            // Small delay to ensure drawer is fully rendered
            setTimeout(() => {
                activeChapterRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }, 100);
        }
    }, [isDrawerVisible]);


    // Save reading progress
    const saveProgress = (sid: string, cid: string, sentenceIdx: number = -1) => {
        const timestamp = Date.now();
        const newProgress = { chapterId: cid, sentenceIndex: sentenceIdx, timestamp };
        try {
            const localProgressStr = localStorage.getItem('readingProgress') || '{}';
            let localProgress = JSON.parse(localProgressStr);
            if (localProgress.storyId) localProgress = { [localProgress.storyId]: localProgress };
            localProgress[sid] = newProgress;
            localStorage.setItem('readingProgress', JSON.stringify(localProgress));
        } catch (e) { console.error(e); }
    };


    const preloadNextChapter = async () => {
        if (isPreloadingNextChapter.current || !storyId || !chapterId || !chapters.length) return;
        const nextChapterNum = Number(chapterId) + 1;
        const hasNextChapter = chapters.some(ch => ch.chapter === nextChapterNum);
        if (!hasNextChapter || (preloadedChapterRef.current?.chapterId === String(nextChapterNum))) return;

        isPreloadingNextChapter.current = true;
        try {
            const response = await fetch(`/api/offline/story/${storyId}/chapter/${nextChapterNum}`);
            const data = await response.json();
            const contentArray = data.content.split('\n').filter((s: string) => s.trim());
            contentArray.unshift(`Chương ${nextChapterNum}: ${data.title}`);

            const preloadedData = { title: data.title, content: contentArray };
            preloadedChapterRef.current = { storyId, chapterId: String(nextChapterNum), data: preloadedData };
            nextChapterContentRef.current = preloadedData;
            console.log(`Preloaded chapter ${nextChapterNum}`);
        } catch (err) {
            console.error("Failed to preload next chapter", err);
        } finally {
            isPreloadingNextChapter.current = false;
        }
    };

    // Unified Reading UI & Layout effect
    useEffect(() => {
        // 1. Scroll locking
        if (readMode === 'page') {
            document.documentElement.style.overflow = 'hidden';
            Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', height: '100%' });
        } else {
            document.documentElement.style.overflow = '';
            Object.assign(document.body.style, { overflow: '', position: '', width: '', height: '' });
        }

        // 2. Scroll listeners for progress and preloading
        const handleScroll = () => {
            if (readMode === 'scroll') {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollHeight = document.documentElement.scrollHeight;
                const clientHeight = document.documentElement.clientHeight;
                const totalScrollable = scrollHeight - clientHeight;
                const progress = totalScrollable > 0 ? (scrollTop / totalScrollable) * 100 : 0;
                setReadingProgress(progress);

                // Trigger preload if near end (> 85%)
                if (progress > 10) preloadNextChapter();
                debouncedSaveProgress();
            } else {
                debouncedSaveProgress();
            }
        };

        // 3. Paging initialization
        let pagingTimer: any;
        if (readMode === 'page' && containerRef.current) {
            pagingTimer = setTimeout(() => {
                if (!containerRef.current) return;
                const { scrollWidth, clientWidth } = containerRef.current;
                const pages = Math.max(1, Math.round(scrollWidth / clientWidth));
                setTotalPages(pages);
                containerRef.current.scrollTo({ left: 0 });
                setCurrentPage(0);
                setReadingProgress((1 / pages) * 100);
            }, 300);
        }

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', handleScroll);
            clearTimeout(pagingTimer);
            document.documentElement.style.overflow = '';
            Object.assign(document.body.style, { overflow: '', position: '', width: '', height: '' });
        };
    }, [readMode, fontSize, lineHeight, contentWidth, chapterId, currentChapter, loading]);

    const handleContainerScroll = () => {
        if (readMode === 'page' && containerRef.current) {
            const { scrollLeft, clientWidth, scrollWidth } = containerRef.current;
            const current = Math.round(scrollLeft / clientWidth);
            const pages = Math.max(1, Math.round(scrollWidth / clientWidth));
            if (pages !== totalPages) setTotalPages(pages);
            if (current !== currentPage) setCurrentPage(current);
            const progress = ((current + 1) / pages) * 100;
            setReadingProgress(progress);

            // Trigger preload if near end of pages
            if (current >= pages - 2) preloadNextChapter();

            debouncedSaveProgress();
        }
    };


    const handleChapterSelect = (chapterNum: number) => {
        if (!storyId) return;
        navigate(`/listen/${storyId}/${chapterNum}`);
        setIsDrawerVisible(false);
        // Loading handled by useEffect
        setTimeout(() => {
            window.scrollTo(0, 0);
        }, 10);
    };

    const goToPrevChapter = () => {
        if (!storyId || !chapterId) return;
        const prevChapterNum = Number(chapterId) - 1;
        if (prevChapterNum < 1) {
            message.info("Đây là chương đầu tiên!");
            return;
        }

        navigate(`/listen/${storyId}/${prevChapterNum}`);
        setTimeout(() => {
            window.scrollTo(0, 0);
        }, 10);
    };

    const goToNextChapter = () => {
        if (!storyId || !chapterId) return;
        setLoading(true);
        setCurrentPage(0);
        const nextChapterNum = Number(chapterId) + 1;
        const hasNextChapter = chapters.some(ch => ch.chapter === nextChapterNum);

        if (hasNextChapter) {
            navigate(`/listen/${storyId}/${nextChapterNum}`);

            setTimeout(() => {
                window.scrollTo(0, 0);
            }, 10);
        } else {
            message.success("Bạn đã đọc hết các chương hiện có!");
        }
        setTimeout(() => {
            setLoading(false);
        }, 100)
    };

    // Swipeable handlers for page navigation
    const swipeHandlers = useSwipeable({
        onSwipedLeft: () => {
            if (readMode === 'page' && currentPage === totalPages - 1 && totalPages > 0) {
                goToNextChapter();
            }
        },
        onSwipedRight: () => {
            if (readMode === 'page' && currentPage === 0) {
                // goToPrevChapter();
            }
        },
        trackMouse: false,
        trackTouch: true,
        preventScrollOnSwipe: false,
        delta: 50,
    });

    // Combine containerRef with swipeHandlers ref
    const handleRefCallback = (el: HTMLDivElement | null) => {
        containerRef.current = el;
        if (readMode === 'page' && swipeHandlers.ref) {
            // @ts-ignore
            swipeHandlers.ref(el);
        }
    };


    return (
        <ConfigProvider theme={{
            token: { colorPrimary: '#1677ff' },
            algorithm: theme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm
        }}>
            <Layout className={`read-layout theme-${theme}`} style={{
                height: readMode === 'page' ? '100dvh' : 'auto',
                minHeight: '100dvh',
                overflow: readMode === 'page' ? 'hidden' : 'visible',
                backgroundColor: 'var(--read-bg)'
            }}>

                <Header className="read-header" style={{
                    position: 'fixed',
                    top: isHidden ? 'calc(-64px - env(safe-area-inset-top))' : 0,
                    zIndex: 1000,
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 20px',
                    paddingTop: 'env(safe-area-inset-top)',
                    transition: 'top 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    height: 'calc(64px + env(safe-area-inset-top))',
                    backgroundColor: 'var(--header-bg)',
                    borderBottomColor: 'var(--border-color)'
                }}>
                    <Space>
                        <Button type="text" icon={<HomeOutlined style={{ color: 'var(--read-text)' }} />} onClick={() => navigate('/')} />
                        <Button type="text" icon={<MenuOutlined style={{ color: 'var(--read-text)' }} />} onClick={() => setIsDrawerVisible(true)} />
                    </Space>
                    <Title level={5} style={{ margin: 0, color: 'var(--read-text)', fontSize: '16px', flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {currentChapter ? `Chương ${chapterId}: ${currentChapter.title}` : 'Loading...'}
                    </Title>
                    <Space>
                        <Button
                            type="text"
                            className='audio-button'
                            icon={<AudioOutlined style={{ color: 'var(--read-text)' }} />}
                            onClick={() => {
                                navigate(`/audio/${storyId}/${chapterId}`);
                                // window.location.href = `/audio/${storyId}/${chapterId}`;
                            }}
                        />
                        <Button type="text" icon={<SettingOutlined style={{ color: 'var(--read-text)' }} />} onClick={() => setIsSettingsVisible(true)} />
                    </Space>
                </Header>

                {/* Mini Info Header - Shows when main header is hidden */}
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    textAlign: 'center',
                    padding: '4px 20px',
                    paddingTop: 'calc(4px + env(safe-area-inset-top))',
                    zIndex: 900,
                    opacity: isHidden ? 0.7 : 0,
                    transform: isHidden ? 'translateY(0)' : 'translateY(-100%)',
                    transition: 'opacity 0.4s ease, transform 0.4s ease',
                    pointerEvents: 'none',
                    fontSize: '11px',
                    color: 'var(--read-text)',
                    background: 'transparent',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textShadow: theme === 'dark' ? '0 1px 2px rgba(0,0,0,0.8)' : '0 1px 2px rgba(255,255,255,0.8)'
                }}>
                    {currentChapter ? `Chương ${chapterId}: ${currentChapter.title}` : ''}
                </div>

                <Content style={{
                    height: readMode === 'page' ? '100dvh' : 'auto',
                    minHeight: readMode === 'page' ? 'auto' : '100dvh',
                    padding: readMode === 'page' ? 0 : '20px 0',
                    paddingTop: readMode === 'page' ? 'env(safe-area-inset-top)' : '20px',
                    paddingBottom: readMode === 'page' ? 'env(safe-area-inset-bottom)' : '20px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    transition: 'none',
                    position: 'relative',
                    overflow: 'hidden',
                    backgroundColor: 'var(--read-bg)'
                }}
                    onClick={(e) => {
                        if (!containerRef.current || readMode !== 'page') return;

                        const x = e.clientX;
                        const w = window.innerWidth;
                        const c = containerRef.current;
                        const maxScrollLeft = c.scrollWidth - c.clientWidth;

                        if (x < w * 0.3) {
                            if (c.scrollLeft > 10) {
                                c.scrollTo({ left: c.scrollLeft - c.clientWidth, behavior: 'smooth' });
                            }
                        } else if (x > w * 0.7) {
                            if (c.scrollLeft < maxScrollLeft - 10) {
                                c.scrollTo({ left: c.scrollLeft + c.clientWidth, behavior: 'smooth' });
                            } else {
                                message.success('Đã chuyển chương');
                                goToNextChapter();
                            }
                        } else {
                            setIsHidden(v => !v);
                        }
                    }}

                >
                    <div
                        ref={handleRefCallback}
                        {...(() => {
                            if (readMode !== 'page') return {};
                            const { ref, ...handlers } = swipeHandlers;
                            return handlers;
                        })()}
                        onScroll={handleContainerScroll}
                        className={readMode === 'page' ? 'paging-container page-mode-container' : 'scroll-container'}
                        style={{
                            width: `${contentWidth}%`,
                            maxWidth: '900px', // Matches Read.css
                            transition: 'all 0.3s ease',
                            ...(readMode === 'page' ? {
                                height: '100%',
                                columnWidth: `${contentWidth}vw`,
                                columnGap: '40px',
                                overflowY: 'hidden',
                                overflowX: 'auto',
                                scrollSnapType: 'x mandatory',
                                padding: '40px 10px'
                            } : {
                                minHeight: '100vh',
                                padding: '10px 15px 20px 15px'
                            })
                        }}
                    >
                        {loading ? (
                            <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
                                <div className="loading-skeleton" />
                                <div className="loading-skeleton" style={{ width: '90%' }} />
                                <div className="loading-skeleton" style={{ width: '95%' }} />
                                <div className="loading-skeleton" style={{ width: '85%' }} />
                            </div>
                        ) : currentChapter ? (
                            <>
                                {currentChapter.content.map((p, index) => (
                                    <Paragraph
                                        key={`${chapterId}-${index}`}
                                        id={`para-${index}`}
                                        className="read-paragraph"
                                        style={{
                                            color: 'var(--read-text)',
                                            fontFamily: fontFamily,
                                            fontSize: index === 0 ? `${fontSize * 1.5}px` : `${fontSize}px`,
                                            fontWeight: index === 0 ? 'bold' : 'normal',
                                            marginBottom: index === 0 ? '40px' : '1.5em',
                                            lineHeight: lineHeight,
                                            scrollSnapAlign: 'start',
                                            scrollSnapStop: 'always',
                                        }}
                                    >
                                        <span className={index === 0 ? "chapter-title-text" : ""}>
                                            {p}
                                        </span>
                                    </Paragraph>
                                ))}
                                <div style={{ textAlign: 'center', padding: '40px 0', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}>
                                    <Button
                                        size="large"
                                        type="primary"
                                        className="read-float-btn"
                                        onClick={goToNextChapter}
                                        disabled={!chapterId || !chapters.some(ch => ch.chapter === Number(chapterId) + 1)}
                                    >
                                        {chapterId && chapters.some(ch => ch.chapter === Number(chapterId) + 1) ? 'Chương Tiếp Theo' : 'Hết Truyện'}
                                    </Button>
                                    {/* <div style={{ height: 100 }} /> */}
                                </div>
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', marginTop: 100 }}>
                                <Text type="secondary">Đang tải...</Text>
                            </div>
                        )}
                    </div>
                </Content>

                <span style={{ position: 'fixed', display: isHidden ? 'block' : 'none', bottom: 10, left: 10, color: 'var(--read-text-muted)', opacity: 0.5, fontSize: '10px', zIndex: 1100, pointerEvents: 'none' }}>
                    {readMode === 'page' ? `Trang ${currentPage + 1}/${totalPages}` : `${Math.round(readingProgress)}%`}
                </span>

                <Footer className="read-footer" style={{
                    position: 'fixed', bottom: isHidden ? -100 : 0, width: '100%', padding: '10px 20px',
                    transition: 'bottom 0.4s cubic-bezier(0.4, 0, 0.2, 1)', zIndex: 1000, height: '64px',
                    backgroundColor: 'var(--footer-bg)',
                    borderTopColor: 'var(--border-color)'
                }}>
                    <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <Button
                            icon={<LeftOutlined />}
                            onClick={goToPrevChapter}
                            type="text"
                            style={{ color: 'var(--read-text)' }}
                        />
                        <div style={{ flex: 1 }}>
                            <Progress percent={Math.round(readingProgress)} showInfo={false} strokeColor="#1677ff" size="small" />
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--read-text-muted)', fontSize: '11px', marginTop: '4px' }}>
                                <span>{readMode === 'page' ? `Trang ${currentPage + 1}/${totalPages}` : `${Math.round(readingProgress)}%`}</span>
                            </div>
                        </div>
                        <Button
                            icon={<RightOutlined />}
                            onClick={goToNextChapter}
                            type="text"
                            style={{ color: 'var(--read-text)' }}
                        />
                    </div>
                </Footer>

                <Drawer
                    title={<span><BookOutlined /> Mục lục</span>}
                    placement="left"
                    onClose={() => setIsDrawerVisible(false)}
                    open={isDrawerVisible}
                    width={300}
                    style={{ backgroundColor: 'var(--read-bg)' }}
                >
                    <List dataSource={chapters} renderItem={(ch) => (
                        <List.Item
                            ref={Number(chapterId) === ch.chapter ? activeChapterRef : null}
                            onClick={() => handleChapterSelect(ch.chapter)}
                            style={{
                                cursor: 'pointer',
                                backgroundColor: Number(chapterId) === ch.chapter ? 'var(--read-highlight)' : 'transparent',
                                padding: '12px 16px',
                                borderRadius: '6px',
                                marginBottom: '4px',
                                border: 'none',
                                color: 'var(--read-text)'
                            }}
                        >
                            <div style={{
                                fontWeight: Number(chapterId) === ch.chapter ? 600 : 400,
                                color: Number(chapterId) === ch.chapter ? '#1677ff' : 'var(--read-text)',
                                fontSize: '14px',
                                lineHeight: '1.5',
                                wordBreak: 'break-word'
                            }}>
                                Chương {ch.chapter}: {ch.title}
                            </div>
                        </List.Item>
                    )} />
                </Drawer>

                <Drawer
                    title="Cài đặt đọc"
                    placement="right"
                    onClose={() => setIsSettingsVisible(false)}
                    open={isSettingsVisible}
                    width={340}
                    style={{ backgroundColor: 'var(--read-bg)' }}
                >
                    <Space direction="vertical" style={{ width: '100%' }} size="large">
                        <div>
                            <div style={{ marginBottom: 10, color: 'var(--read-text)' }}><ReadOutlined /> Chế độ đọc</div>
                            <Segmented block value={readMode} onChange={setReadMode} options={[{ label: 'Cuộn dọc', value: 'scroll', icon: <VerticalAlignMiddleOutlined /> }, { label: 'Lật trang', value: 'page', icon: <EllipsisOutlined /> }]} />
                        </div>

                        <Divider style={{ margin: '8px 0', borderColor: 'var(--border-color)' }} />

                        <div>
                            <div style={{ marginBottom: 10, color: 'var(--read-text)' }}><BgColorsOutlined /> Giao diện</div>
                            <Radio.Group value={theme} onChange={(e) => setTheme(e.target.value as ThemeKey)} buttonStyle="solid" style={{ width: '100%', display: 'flex' }}>
                                {(Object.keys(THEMES) as ThemeKey[]).map(t => <Radio.Button key={t} value={t} style={{ flex: 1, textAlign: 'center' }}>{THEMES[t].name}</Radio.Button>)}
                            </Radio.Group>
                        </div>

                        <div>
                            <div style={{ marginBottom: 10, color: 'var(--read-text)' }}><FontColorsOutlined /> Kiểu chữ</div>
                            <Select
                                style={{ width: '100%' }}
                                value={fontFamily}
                                onChange={setFontFamily}
                                options={FONTS.map(f => ({
                                    label: <span style={{ fontFamily: f.value }}>{f.label}</span>,
                                    value: f.value
                                }))}
                            />
                        </div>

                        <div>
                            <div style={{ marginBottom: 10, color: 'var(--read-text)' }}><FontSizeOutlined /> Kích thước ({fontSize}px)</div>
                            <Slider min={14} max={32} value={fontSize} onChange={setFontSize} />
                        </div>

                        <div>
                            <div style={{ marginBottom: 10, color: 'var(--read-text)' }}><VerticalAlignMiddleOutlined /> Khoảng cách dòng ({lineHeight.toFixed(1)})</div>
                            <Slider min={1.0} max={3.0} step={0.1} value={lineHeight} onChange={setLineHeight} />
                        </div>

                        <div>
                            <div style={{ marginBottom: 10, color: 'var(--read-text)' }}><ColumnWidthOutlined /> Độ rộng khung hình ({contentWidth}%)</div>
                            <Slider min={50} max={100} step={5} value={contentWidth} onChange={setContentWidth} />
                        </div>
                    </Space>
                </Drawer>
            </Layout>
        </ConfigProvider>
    );
};

export default Read;