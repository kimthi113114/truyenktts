import React from 'react';
import {
    BackwardOutlined,
    ForwardOutlined,
    PlayCircleFilled,
    PauseCircleFilled
} from '@ant-design/icons';
import { Slider } from 'antd';
import type { Chapter } from '../../hooks/useTTSPlayer';

interface AudioPlayerControlsProps {
    isCollapsed: boolean;
    setIsCollapsed: (v: boolean) => void;
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    loading: boolean;
    selectedStoryId: string;
    selectedChapterId: string;
    chapters: Record<number, Chapter>;
    onSliderChange: (val: number) => void;
    onTogglePlay: () => void;
    onNextSentence: () => void;
    onPrevSentence: () => void;
    onChapterSelect: (cid: string) => void;
}

const AudioPlayerControls: React.FC<AudioPlayerControlsProps> = ({
    isCollapsed,
    setIsCollapsed,
    currentTime,
    duration,
    isPlaying,
    loading,
    selectedStoryId,
    selectedChapterId,
    chapters,
    onSliderChange,
    onTogglePlay,
    onNextSentence,
    onPrevSentence,
    onChapterSelect
}) => {
    const formatTime = (seconds: number) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    return (
        <div >
            <div
                className="audio-player-collapse-handle"
                onClick={() => {
                    setIsCollapsed(!isCollapsed);
                    localStorage.setItem('controlsCollapsed', String(!isCollapsed));
                }}
            />
            <div style={{ marginBottom: '32px' }}></div>

            {/* Progress Bar */}
            <div className="audio-player-slider-container" style={{ padding: '0 10px', marginBottom: '5px' }}>
                <Slider
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={onSliderChange}
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
                <button className="audio-player-btn-control" onClick={onPrevSentence} disabled={loading} title="Câu trước">
                    <BackwardOutlined style={{ fontSize: '24px' }} />
                </button>

                <button className={`audio-player-btn-play ${isPlaying ? 'playing' : ''}`} onClick={onTogglePlay} disabled={loading}>
                    {isPlaying ? (
                        <PauseCircleFilled style={{ fontSize: '72px' }} />
                    ) : (
                        <PlayCircleFilled style={{ fontSize: '72px' }} />
                    )}
                </button>

                <button className="audio-player-btn-control" onClick={onNextSentence} disabled={loading} title="Câu tiếp theo">
                    <ForwardOutlined style={{ fontSize: '24px' }} />
                </button>
            </div>

            <div style={{ marginBottom: '10px' }}></div>
            {/* Selection Controls */}
            <div className="audio-player-select-row">
                <select
                    className="audio-player-select"
                    style={{ flex: 1 }}
                    value={selectedChapterId}
                    onChange={(e) => onChapterSelect(e.target.value)}
                    disabled={!selectedStoryId || loading}
                >
                    <option value="">Chọn Chương</option>
                    {Object.keys(chapters).map(Number).sort((a, b) => a - b).map(num => (
                        <option key={num} value={num}>Chương {num}: {chapters[num].title}</option>
                    ))}
                </select>
            </div>
        </div>
    );
};

export default AudioPlayerControls;
