import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error('Unknown error') };
  }

  componentDidCatch() {
    // swallow
  }

  render() {
    const error = this.state?.error;
    if (!error) return this.props.children;
    const title = this.props.title || 'View crashed';
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">{title}</div>
        <div className="panel-empty-subtitle">{error?.message || String(error)}</div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      </div>
    );
  }
}

