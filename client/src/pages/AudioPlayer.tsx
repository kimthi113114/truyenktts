import React, { useState, useEffect } from 'react';
import { useTTSPlayer } from '../hooks/useTTSPlayer';
import AudioPlayerHeader from '../components/AudioPlayer/AudioPlayerHeader';
import AudioPlayerVisual from '../components/AudioPlayer/AudioPlayerVisual';
import AudioPlayerControls from '../components/AudioPlayer/AudioPlayerControls';
import AudioPlayerSettings from '../components/AudioPlayer/AudioPlayerSettings';
import SleepTimerModal from '../components/AudioPlayer/SleepTimerModal';
import './AudioPlayer.css';

const AudioPlayer: React.FC = () => {
    // Hook
    const {
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
        handlePrevChapter
    } = useTTSPlayer();

    // Local UI state
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [showLyrics, setShowLyrics] = useState(false);
    const [showSleepModal, setShowSleepModal] = useState(false);

    useEffect(() => {
        const savedCollapsed = localStorage.getItem('controlsCollapsed') === 'true';
        setIsCollapsed(savedCollapsed);
    }, []);

    const handleSliderChange = (value: number) => {
        if (!duration) return;
        audioRef.current.currentTime = value;
        setCurrentTime(value);
    };

    const handleVoiceChange = (newVoice: string) => {
        if (selectedChapterId) playChapter(selectedChapterId, audioRef.current.currentTime, true, newVoice);
    };

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
                <AudioPlayerHeader
                    selectedStoryId={selectedStoryId}
                    selectedChapterId={selectedChapterId}
                    stories={stories}
                    chapters={chapters}
                />

                <AudioPlayerVisual
                    isCollapsed={isCollapsed}
                    isPlaying={isPlaying}
                    showLyrics={showLyrics}
                    setShowLyrics={setShowLyrics}
                    subtitles={subtitles}
                    currentTime={currentTime}
                    onSeek={(time) => { audioRef.current.currentTime = time; }}
                />

                <div className={`audio-player-controls-area ${isCollapsed ? 'collapsed' : ''}`}>
                    <AudioPlayerControls
                        isCollapsed={isCollapsed}
                        setIsCollapsed={setIsCollapsed}
                        currentTime={currentTime}
                        duration={duration}
                        isPlaying={isPlaying}
                        loading={loading}
                        selectedStoryId={selectedStoryId}
                        selectedChapterId={selectedChapterId}
                        chapters={chapters}
                        onSliderChange={handleSliderChange}
                        onTogglePlay={togglePlay}
                        onNextSentence={handleNextSentence}
                        onPrevSentence={handlePrevSentence}
                        onChapterSelect={(cid) => playChapter(cid)}
                    />

                    <AudioPlayerSettings
                        loading={loading}
                        showLyrics={showLyrics}
                        setShowLyrics={setShowLyrics}
                        sleepTimer={sleepTimer}
                        setShowSleepModal={setShowSleepModal}
                        speed={speed}
                        setSpeed={(v) => {
                            setSpeed(v);
                            if (audioRef.current) audioRef.current.playbackRate = v;
                        }}
                        voice={voice}
                        setVoice={setVoice}
                        onVoiceChange={handleVoiceChange}
                    />
                </div>
            </div>

            {showSleepModal && (
                <SleepTimerModal
                    sleepTimer={sleepTimer}
                    setSleepTimer={setSleepTimer}
                    setShowSleepModal={setShowSleepModal}
                />
            )}
        </div>
    );
};

export default AudioPlayer;
