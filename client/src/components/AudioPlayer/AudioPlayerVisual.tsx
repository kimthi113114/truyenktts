import React, { useRef, useEffect } from 'react';
import { SoundOutlined } from '@ant-design/icons';
import type { Subtitle } from '../../hooks/useTTSPlayer';

interface AudioPlayerVisualProps {
    isCollapsed: boolean;
    isPlaying: boolean;
    showLyrics: boolean;
    setShowLyrics: (show: boolean) => void;
    subtitles: Subtitle[];
    currentTime: number;
    onSeek: (time: number) => void;
}

const AudioPlayerVisual: React.FC<AudioPlayerVisualProps> = ({
    isCollapsed,
    isPlaying,
    showLyrics,
    setShowLyrics,
    subtitles,
    currentTime,
    onSeek
}) => {
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
        <div className={`audio-player-visual-area ${isCollapsed ? 'expanded' : ''}`}>
            <div className={`audio-player-album-art ${isPlaying ? 'playing' : ''} ${showLyrics ? 'hidden' : ''}`} onClick={() => setShowLyrics(true)}>
                <img src="/icon/favico.png" alt="Album Art" />
            </div>

            {/* Lyrics Overlay */}
            <div className={`audio-player-subtitle-container ${showLyrics ? 'visible' : ''}`}
                onClick={() => setShowLyrics(false)}>
                {subtitles.length > 0 ? subtitles.map((sub, i) => (
                    <p
                        key={i}
                        className={`audio-player-sub-line ${i === activeSubIndex ? 'active' : ''}`}
                        ref={i === activeSubIndex ? activeSubtitleRef : null}
                        onClick={(e) => { e.stopPropagation(); onSeek(sub.start); }}
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
    );
};

export default AudioPlayerVisual;
