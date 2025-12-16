import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const Modal = ({ 
    isOpen, 
    onClose, 
    title, 
    children, 
    footer, 
    width = '500px',
    height = 'auto',
    closeOnBackdropClick = true 
}) => {
    const backdropRef = useRef(null);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }
        
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleBackdropClick = (e) => {
        if (closeOnBackdropClick && e.target === backdropRef.current) {
            onClose();
        }
    };

    return createPortal(
        <div 
            className="modal-backdrop" 
            ref={backdropRef}
            onClick={handleBackdropClick}
        >
            <div 
                className="modal-container"
                style={{ width, height, maxHeight: '90vh' }}
            >
                <div className="modal-header">
                    <h3 className="modal-title">{title}</h3>
                    <button className="modal-close-btn" onClick={onClose}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div className="modal-body">
                    {children}
                </div>
                {footer && (
                    <div className="modal-footer">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default Modal;
