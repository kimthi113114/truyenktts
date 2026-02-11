import React from 'react';
import {
    CustomerServiceOutlined,
    ClockCircleOutlined,
    GlobalOutlined,
    SoundOutlined
} from '@ant-design/icons';

interface AudioPlayerSettingsProps {
    loading: boolean;
    showLyrics: boolean;
    setShowLyrics: (v: boolean) => void;
    sleepTimer: number | 'end' | null;
    setShowSleepModal: (v: boolean) => void;
    speed: number;
    setSpeed: (v: number) => void;
    voice: string;
    setVoice: (v: string) => void;
    onVoiceChange: (voice: string) => void;
}

const AudioPlayerSettings: React.FC<AudioPlayerSettingsProps> = ({
    loading,
    showLyrics,
    setShowLyrics,
    sleepTimer,
    setShowSleepModal,
    speed,
    setSpeed,
    voice,
    setVoice,
    onVoiceChange
}) => {
    return (
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
                        onVoiceChange(newVoice);
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
    );
};

export default AudioPlayerSettings;
