import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spin, Typography, message, Segmented, Row, Col, Skeleton } from 'antd';
import { AppstoreOutlined, BarsOutlined, CloudSyncOutlined, PlayCircleFilled, ReadOutlined } from '@ant-design/icons';
import './Home.css';

const { Title, Text } = Typography;

interface Story {
    id: string;
    title: string;
    author: string;
    cover: string;
    hidden?: boolean;
}

interface Progress {
    chapterId: string;
    timestamp: number;
}

const Home: React.FC = () => {
    const [stories, setStories] = useState<Story[]>([]);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>(
        (localStorage.getItem('viewMode') as 'grid' | 'list') || 'grid'
    );
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState<Record<string, Progress>>({});
    const [syncing, setSyncing] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchData = async () => {
            let currentStories: Story[] = [];
            let currentProgress: Record<string, Progress> = {};
            const sortStories = (list: Story[], prog: Record<string, Progress>) => {
                return [...list].sort((a, b) => {
                    const progA = prog[a.id];
                    const progB = prog[b.id];
                    if (progA && progB) return (progB.timestamp || 0) - (progA.timestamp || 0);
                    if (progA) return -1;
                    if (progB) return 1;
                    return 0;
                });
            };

            // Start Sync Request (Parallel execution)
            const userStr = localStorage.getItem('user');
            let syncPromise: Promise<any> = Promise.resolve(null);

            if (userStr) {
                const user = JSON.parse(userStr);
                syncPromise = (async () => {
                    try {
                        message.loading({ content: 'Đang tải dữ liệu từ OneDrive...', key: 'sync' });
                        const historyResp = await fetch(`/api/sync/load/${user.username}`);
                        if (historyResp.ok) {
                            return await historyResp.json();
                        }
                    } catch (err) {
                        console.error("History fetch error", err);
                    } finally {
                        message.destroy('sync');
                    }
                    return null;
                })();
            }

            try {
                // Minimum loading time for smooth UX
                const start = Date.now();
                const storiesResp = await fetch('/api/stories-listen');
                const storiesData = await storiesResp.json();

                if (Array.isArray(storiesData)) {
                    currentStories = storiesData;
                }

                // Load local progress logic
                const localProgressStr = localStorage.getItem('readingProgress');
                if (localProgressStr) {
                    try {
                        const parsed = JSON.parse(localProgressStr);
                        if (parsed.storyId) {
                            currentProgress[parsed.storyId] = parsed;
                        } else {
                            currentProgress = parsed;
                        }
                    } catch (e) { console.warn(e); }
                }

                // Initial Sort & Render
                currentStories = sortStories(currentStories, currentProgress);
                setStories(currentStories);
                setProgress(currentProgress);

                // Ensure at least 500ms loading for optical smoothness (prevent flicker)
                const elapsed = Date.now() - start;
                if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed));

            } catch (error) {
                console.error('Error loading stories:', error);
                message.error('Không thể tải danh sách truyện');
            } finally {
                setLoading(false);
            }

            // Sync logic - Handle the result of the parallel request
            const historyData = await syncPromise;
            if (historyData && historyData.success && historyData.data) {
                const remoteMap = typeof historyData.data === 'string' ? JSON.parse(historyData.data) : historyData.data;

                let hasNewData = false;
                Object.keys(remoteMap).forEach(k => {
                    if (!currentProgress[k] || (remoteMap[k].timestamp > currentProgress[k].timestamp)) {
                        currentProgress[k] = remoteMap[k];
                        hasNewData = true;
                    }
                });

                if (hasNewData) {
                    const updatedStories = sortStories(currentStories, currentProgress);
                    setStories(updatedStories);
                    setProgress({ ...currentProgress });
                }
            }
        };

        fetchData();
    }, []);

    const handleSync = () => {
        if (syncing) return;
        setSyncing(true);
        message.loading({ content: 'Đang đồng bộ OneDrive...', key: 'sync' });

        const eventSource = new EventSource('/api/onedrive/init-download');

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'log') {
                message.loading({ content: data.message, key: 'sync' });
            } else if (data.type === 'file') {
                message.loading({ content: `Đang tải: ${data.name}...`, key: 'sync' });
            } else if (data.status === 'done' || data.type === 'done') {
                message.success({ content: 'Đồng bộ hoàn tất!', key: 'sync' });
                eventSource.close();
                setTimeout(() => {
                    setSyncing(false);
                    window.location.reload();
                }, 1500);
            } else if (data.type === 'error') {
                message.error({ content: `Lỗi: ${data.message}`, key: 'sync' });
                eventSource.close();
                setSyncing(false);
            }
        };

        eventSource.onerror = (e) => {
            console.error('SSE Error:', e);
            message.error({ content: 'Lỗi đồng bộ', key: 'sync' });
            eventSource.close();
            setSyncing(false);
        };
    };

    return (
        <div className="home-container">
            {/* Header Section */}
            <div className="home-header">
                <Row justify="space-between" align="middle">
                    <Col>
                        <Title level={2} style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.5px' }}>Thư viện</Title>
                        <Text type="secondary" style={{ fontSize: '0.9rem' }}>{loading ? 'Đang tải...' : `${stories.length} cuốn truyện`}</Text>
                    </Col>
                    <Col>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <Segmented
                                options={[
                                    { value: 'grid', icon: <AppstoreOutlined /> },
                                    { value: 'list', icon: <BarsOutlined /> },
                                ]}
                                value={viewMode}
                                onChange={(val: any) => {
                                    setViewMode(val);
                                    localStorage.setItem('viewMode', val);
                                }}
                            />
                            <Button
                                type={syncing ? 'default' : 'primary'}
                                icon={<CloudSyncOutlined spin={syncing} />}
                                onClick={handleSync}
                                disabled={syncing}
                                shape="round"
                            >
                                {syncing ? 'Synching...' : 'Đồng bộ'}
                            </Button>
                        </div>
                    </Col>
                </Row>
            </div>

            {/* Content Section */}
            <div style={{ flex: 1, width: '100%' }}>
                {loading ? (
                    <div className="story-grid">
                        {[...Array(10)].map((_, i) => (
                            <div key={i} style={{ borderRadius: 12, overflow: 'hidden' }}>
                                <Skeleton.Image active style={{ width: '100%', height: 200 }} />
                                <div style={{ marginTop: 12 }}>
                                    <Skeleton active title={false} paragraph={{ rows: 2, width: ['90%', '60%'] }} />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <>
                        {/* Grid View */}
                        {viewMode === 'grid' && (
                            <div className="story-grid">
                                {stories.map((story, index) => {
                                    const lastChapter = progress[story.id]?.chapterId || 1;
                                    const hasProgress = !!progress[story.id];

                                    return (
                                        <div
                                            key={story.id}
                                            className="story-card"
                                            onClick={() => navigate(`/listen/${story.id}/${lastChapter}`)}
                                            style={{ animationDelay: `${index * 50}ms` }} // Staggered Animation
                                        >
                                            <div className="story-cover-wrapper">
                                                <img
                                                    src={story.cover ? `/covers/${story.cover}` : '/covers/default.jpg'}
                                                    alt={story.title}
                                                    className="story-cover"
                                                    loading="lazy"
                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x600/e2e8f0/1e293b?text=No+Cover'; }}
                                                />
                                                <div className="story-overlay">
                                                    <div className="play-icon-wrapper">
                                                        <PlayCircleFilled style={{ fontSize: 24, color: '#1677ff' }} />
                                                    </div>
                                                </div>
                                                {hasProgress && (
                                                    <div className="chapter-badge">Chương {lastChapter}</div>
                                                )}
                                            </div>
                                            <div className="story-info">
                                                <h3 className="story-title" title={story.title}>{story.title}</h3>
                                                <span className="story-author">{story.author || 'Đang cập nhật'}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* List View */}
                        {viewMode === 'list' && (
                            <div className="list-container">
                                {stories.map((story, index) => {
                                    const lastChapter = progress[story.id]?.chapterId || 1;
                                    const hasProgress = !!progress[story.id];

                                    return (
                                        <div
                                            key={story.id}
                                            className="list-item-card"
                                            onClick={() => navigate(`/listen/${story.id}/${lastChapter}`)}
                                            style={{ animationDelay: `${index * 50}ms` }}
                                        >
                                            <div className="list-item-content">
                                                <img
                                                    src={story.cover ? `/covers/${story.cover}` : '/covers/default.jpg'}
                                                    alt={story.title}
                                                    className="list-cover"
                                                    loading="lazy"
                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x600/e2e8f0/1e293b?text=No+Cover'; }}
                                                />
                                                <div className="list-info">
                                                    <span className="list-title">{story.title}</span>
                                                    <span className="list-author">{story.author || 'Đang cập nhật'}</span>

                                                    {hasProgress && (
                                                        <div className="continue-reading-text">
                                                            <ReadOutlined /> Đang đọc chương {lastChapter}
                                                        </div>
                                                    )}

                                                    <div style={{ marginTop: 'auto' }}>
                                                        <Button type="primary" shape="round" size="small" onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigate(`/listen/${story.id}/${lastChapter}`);
                                                        }}>
                                                            {hasProgress ? 'Đọc tiếp' : 'Bắt đầu đọc'}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default Home;
