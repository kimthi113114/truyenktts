import React from 'react';

interface SleepTimerModalProps {
    sleepTimer: number | 'end' | null;
    setSleepTimer: (val: number | 'end' | null) => void;
    setShowSleepModal: (val: boolean) => void;
}

const SleepTimerModal: React.FC<SleepTimerModalProps> = ({
    sleepTimer,
    setSleepTimer,
    setShowSleepModal
}) => {
    return (
        <div className="audio-player-modal-backdrop" onClick={() => setShowSleepModal(false)}>
            <div className="audio-player-modal-content" onClick={e => e.stopPropagation()}>
                <h3 className="modal-title">Hẹn giờ tắt</h3>
                <div className="timer-grid">
                    {[5, 15, 30, 60].map(m => (
                        <button key={m} className={`timer-btn ${sleepTimer === m ? 'active' : ''}`} onClick={() => { setSleepTimer(m); setShowSleepModal(false); }}>
                            {m} phút
                        </button>
                    ))}
                    <button className={`timer-btn ${sleepTimer === 'end' ? 'active' : ''}`} style={{ gridColumn: 'span 2' }} onClick={() => { setSleepTimer('end'); setShowSleepModal(false); }}>
                        Hết chương này
                    </button>
                    {sleepTimer && (
                        <button className="timer-btn cancel" onClick={() => { setSleepTimer(null); setShowSleepModal(false); }}>
                            Tắt hẹn giờ
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SleepTimerModal;
