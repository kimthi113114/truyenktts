import React, { useEffect, useState } from 'react';
import { Modal, List, Typography, Button, Spin, Pagination, Row, Col, message, Image, Grid } from 'antd';
import { PlayCircleFilled, ReadOutlined, CloseOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

const { Title, Text, Paragraph } = Typography;
const { useBreakpoint } = Grid;

interface Story {
    id: string;
    title: string;
    author: string;
    cover: string;
    hidden?: boolean;
}

interface Chapter {
    chapter: number;
    title: string;
}

interface StoryDetailDialogProps {
    open: boolean;
    story: Story | null;
    onClose: () => void;
    currentProgress?: {
        chapterId: string;
        timestamp: number;
    };
}

const StoryDetailDialog: React.FC<StoryDetailDialogProps> = ({ open, story, onClose, currentProgress }) => {
    const navigate = useNavigate();
    const screens = useBreakpoint();
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    const isMobile = !screens.md;

    useEffect(() => {
        if (open && story) {
            fetchChapters();
        } else {
            setChapters([]);
        }
    }, [open, story]);

    const fetchChapters = async () => {
        if (!story) return;
        setLoading(true);
        try {
            const data = await api.get(`/api/offline/story/${story.id}/chapters`);
            setChapters(data.chapters || []);
        } catch (error) {
            console.error('Error fetching chapters:', error);
            message.error('Không thể tải danh sách chương');
        } finally {
            setLoading(false);
        }
    };

    const handleChapterClick = (chapterId: number) => {
        if (!story) return;
        navigate(`/listen/${story.id}/${chapterId}`);
        onClose(); // Optional: close dialog when navigating
    };

    const handleContinueReading = () => {
        if (!story) return;
        const chapterId = currentProgress?.chapterId || 1;
        navigate(`/listen/${story.id}/${chapterId}`);
        onClose();
    };

    // Pagination logic
    const paginatedChapters = chapters.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    if (!story) return null;

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={isMobile ? '100%' : 800}
            className="story-detail-modal"
            centered={!isMobile}
            style={isMobile ? { top: 0, margin: 0, maxWidth: '100vw', padding: 0 } : {}}
            bodyStyle={isMobile ? { padding: 0, height: '100%', overflow: 'hidden' } : { padding: 0, overflow: 'hidden' }}
            closeIcon={<CloseOutlined style={{ fontSize: 18, color: '#666' }} />}
            destroyOnClose
            wrapClassName={isMobile ? 'full-screen-modal' : ''}
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: isMobile ? '100%' : '80vh', maxHeight: isMobile ? 'none' : '700px' }}>
                {/* Header Section */}
                <div style={{
                    padding: '24px',
                    borderBottom: '1px solid #f0f0f0',
                    background: '#fff',
                    flexShrink: 0 // Ensure header doesn't shrink
                }}>
                    <Row gutter={[24, 24]}>
                        <Col xs={8} sm={8} md={6}>
                            <div style={{
                                position: 'relative',
                                borderRadius: '8px',
                                overflow: 'hidden',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                            }}>
                                <Image
                                    src={story.cover ? `/covers/${story.cover}` : '/covers/default.jpg'}
                                    alt={story.title}
                                    width="100%"
                                    style={{ aspectRatio: '2/3', objectFit: 'cover' }}
                                    preview={false}
                                    fallback="https://placehold.co/400x600/e2e8f0/1e293b?text=No+Cover"
                                />
                            </div>
                        </Col>
                        <Col xs={16} sm={16} md={18} style={{ display: 'flex', flexDirection: 'column' }}>
                            <Title level={isMobile ? 4 : 3} style={{ marginTop: 0, marginBottom: 8 }}>{story.title}</Title>
                            <Text type="secondary" style={{ fontSize: isMobile ? '14px' : '16px', marginBottom: 16 }}>
                                Tác giả: <Text strong>{story.author || 'Đang cập nhật'}</Text>
                            </Text>

                            {/* Description can be added here if available */}
                            {/* <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: 'more' }}>
                                {story.description || 'Chưa có mô tả cho truyện này.'}
                            </Paragraph> */}

                            <div style={{ marginTop: 'auto', display: 'flex', gap: 12 }}>
                                <Button
                                    type="primary"
                                    size={isMobile ? "middle" : "large"}
                                    icon={<ReadOutlined />}
                                    onClick={handleContinueReading}
                                    shape="round"
                                >
                                    {currentProgress ? `Đọc tiếp (Chương ${currentProgress.chapterId})` : 'Bắt đầu đọc'}
                                </Button>
                            </div>
                        </Col>
                    </Row>
                </div>

                {/* Chapter List Section */}
                <div style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: '0 24px',
                    backgroundColor: '#fafafa'
                }}>
                    <div style={{ padding: '16px 0' }}>
                        <Title level={5} style={{ marginTop: 0 }}>Danh sách chương ({chapters.length})</Title>
                    </div>

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '40px' }}>
                            <Spin tip="Đang tải chương..." />
                        </div>
                    ) : (
                        <List
                            dataSource={paginatedChapters}
                            renderItem={(item) => (
                                <List.Item
                                    className={`chapter-item ${Number(currentProgress?.chapterId) === item.chapter ? 'reading-chapter' : ''}`}
                                    onClick={() => handleChapterClick(item.chapter)}
                                    style={{
                                        cursor: 'pointer',
                                        padding: '12px 16px',
                                        background: Number(currentProgress?.chapterId) === item.chapter ? '#e6f7ff' : '#fff',
                                        marginBottom: 8,
                                        borderRadius: 6,
                                        border: '1px solid #f0f0f0',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                        <Text strong={Number(currentProgress?.chapterId) === item.chapter} style={{ fontSize: 15 }}>
                                            Chương {item.chapter}: {item.title}
                                        </Text>
                                        {Number(currentProgress?.chapterId) === item.chapter && (
                                            <Text type="secondary" style={{ fontSize: 12 }}><ReadOutlined /> Đang đọc</Text>
                                        )}
                                    </div>
                                </List.Item>
                            )}
                        />
                    )}
                </div>

                {/* Pagination Footer */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid #f0f0f0',
                    textAlign: 'right',
                    background: '#fff'
                }}>
                    <Pagination
                        current={currentPage}
                        pageSize={pageSize}
                        total={chapters.length}
                        onChange={(page, size) => {
                            setCurrentPage(page);
                            setPageSize(size);
                        }}
                        showSizeChanger
                        onShowSizeChange={(current, size) => {
                            setPageSize(size);
                            setCurrentPage(1); // Reset to first page on size change
                        }}
                        pageSizeOptions={['10', '20', '50', '100']}
                        simple={window.innerWidth < 576} // Simple mode on mobile
                    />
                </div>
            </div>
        </Modal>
    );
};

export default StoryDetailDialog;
