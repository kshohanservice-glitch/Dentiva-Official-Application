import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    // technical details go to the main-process log via console.error (captured), user sees friendly UI
    console.error('Renderer error', error);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="auth-screen">
          <div className="auth-card" style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              An unexpected error occurred. Your data is safe — reload the application to continue.
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppProviders />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
