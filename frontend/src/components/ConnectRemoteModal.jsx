import React, { useState } from 'react';
import Modal from './Modal';

const ConnectRemoteModal = ({ isOpen, onClose, onConnect }) => {
    const [formData, setFormData] = useState({
        host: '',
        port: '22',
        username: 'root',
        authType: 'password', // or 'privateKey'
        password: '',
        privateKeyPath: ''
    });
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setError('');
    };

    const handleSubmit = async () => {
        if (!formData.host) {
            setError('Host is required');
            return;
        }
        setConnecting(true);
        try {
            await onConnect(formData);
            onClose();
        } catch (err) {
            setError(err.message || 'Connection failed');
        } finally {
            setConnecting(false);
        }
    };

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title="Connect to Remote Host"
            width="450px"
            footer={
                <>
                    <button className="secondary-btn" onClick={onClose} disabled={connecting}>Cancel</button>
                    <button className="primary-btn" onClick={handleSubmit} disabled={connecting}>
                        {connecting ? 'Connecting...' : 'Connect'}
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
                    <label>Host</label>
                    <input 
                        className="form-input"
                        value={formData.host} 
                        onChange={e => handleChange('host', e.target.value)} 
                        placeholder="example.com or 192.168.1.1"
                        autoFocus
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="form-group">
                        <label>Port</label>
                        <input 
                            className="form-input"
                            value={formData.port} 
                            onChange={e => handleChange('port', e.target.value)} 
                            placeholder="22"
                        />
                    </div>
                    <div className="form-group">
                        <label>Username</label>
                        <input 
                            className="form-input"
                            value={formData.username} 
                            onChange={e => handleChange('username', e.target.value)} 
                            placeholder="root"
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label>Authentication Method</label>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                            <input 
                                type="radio" 
                                checked={formData.authType === 'password'} 
                                onChange={() => handleChange('authType', 'password')}
                            />
                            Password
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                            <input 
                                type="radio" 
                                checked={formData.authType === 'privateKey'} 
                                onChange={() => handleChange('authType', 'privateKey')}
                            />
                            Private Key
                        </label>
                    </div>
                </div>

                {formData.authType === 'password' ? (
                    <div className="form-group">
                        <label>Password</label>
                        <input 
                            className="form-input"
                            type="password"
                            value={formData.password} 
                            onChange={e => handleChange('password', e.target.value)} 
                            placeholder="Enter password"
                        />
                    </div>
                ) : (
                    <div className="form-group">
                        <label>Private Key Path</label>
                        <input 
                            className="form-input"
                            value={formData.privateKeyPath} 
                            onChange={e => handleChange('privateKeyPath', e.target.value)} 
                            placeholder="/path/to/private/key"
                        />
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default ConnectRemoteModal;
