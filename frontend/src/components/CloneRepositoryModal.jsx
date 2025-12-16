import React, { useState } from 'react';
import Modal from './Modal';

const CloneRepositoryModal = ({ isOpen, onClose, onClone, onPickFolder }) => {
    const [url, setUrl] = useState('');
    const [parentDir, setParentDir] = useState('');
    const [folderName, setFolderName] = useState('');
    const [cloning, setCloning] = useState(false);
    const [error, setError] = useState('');

    const handlePickFolder = async () => {
        try {
            const path = await onPickFolder();
            if (path) setParentDir(path);
        } catch (err) {
            setError('Failed to pick folder');
        }
    };

    const deriveFolderName = (u) => {
        const raw = String(u || '').trim();
        if (!raw) return '';
        const last = raw.split('/').pop() || raw.split(':').pop() || '';
        return last.replace(/\.git$/i, '') || '';
    };

    const handleUrlChange = (e) => {
        const val = e.target.value;
        setUrl(val);
        if (!folderName) {
            const derived = deriveFolderName(val);
            if (derived) setFolderName(derived);
        }
    };

    const handleSubmit = async () => {
        if (!url) {
            setError('URL is required');
            return;
        }
        if (!parentDir) {
            setError('Destination folder is required');
            return;
        }
        setCloning(true);
        setError('');
        try {
            await onClone({ url, parentDir, folderName });
            onClose();
        } catch (err) {
            setError(err.message || 'Clone failed');
        } finally {
            setCloning(false);
        }
    };

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title="Clone Git Repository"
            width="450px"
            footer={
                <>
                    <button className="secondary-btn" onClick={onClose} disabled={cloning}>Cancel</button>
                    <button className="primary-btn" onClick={handleSubmit} disabled={cloning}>
                        {cloning ? 'Cloning...' : 'Clone'}
                    </button>
                </>
            }
        >
             <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {error && (
                    <div style={{ padding: '0.5rem', background: 'var(--danger)', color: 'white', borderRadius: '4px', fontSize: '0.9rem' }}>
                        {error}
                    </div>
                )}
                
                <div className="form-group">
                    <label>Repository URL</label>
                    <input 
                        className="form-input"
                        value={url} 
                        onChange={handleUrlChange} 
                        placeholder="https://github.com/user/repo.git"
                        autoFocus
                    />
                </div>

                <div className="form-group">
                    <label>Destination Folder</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input 
                            className="form-input"
                            value={parentDir} 
                            onChange={e => setParentDir(e.target.value)} 
                            placeholder="Select parent folder..."
                        />
                        <button className="secondary-btn" onClick={handlePickFolder} disabled={cloning} style={{ whiteSpace: 'nowrap' }}>
                            Choose...
                        </button>
                    </div>
                </div>

                <div className="form-group">
                    <label>Folder Name (Optional)</label>
                    <input 
                        className="form-input"
                        value={folderName} 
                        onChange={e => setFolderName(e.target.value)} 
                        placeholder="repo-name"
                    />
                </div>
            </div>
        </Modal>
    );
};

export default CloneRepositoryModal;
