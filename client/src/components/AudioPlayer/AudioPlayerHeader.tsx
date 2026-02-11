import React from 'react';
import { LeftOutlined, ReadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { Chapter, Story } from '../../hooks/useTTSPlayer';

interface AudioPlayerHeaderProps {
    selectedStoryId: string;
    selectedChapterId: string;
    stories: Story[];
    chapters: Record<number, Chapter>;
}

const AudioPlayerHeader: React.FC<AudioPlayerHeaderProps> = ({
    selectedStoryId,
    selectedChapterId,
    stories,
    chapters
}) => {
    const navigate = useNavigate();

    return (
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
    );
};

export default AudioPlayerHeader;
