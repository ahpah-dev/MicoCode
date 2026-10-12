'use client';
import {Component,type ErrorInfo,type ReactNode} from 'react';
import {ShieldAlert,RotateCcw,RefreshCw} from 'lucide-react';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null; errorInfo: ErrorInfo | null };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[MicoCode] Recovered from rendering error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = (): void => {
    try {
      // Clear transient UI state without wiping saved projects or files
      sessionStorage.removeItem('mico-transient');
    } catch {}
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="error-recovery-shell" style={{
          height: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--bg, #111815)',
          color: 'var(--text, #e8f5ee)',
          fontFamily: 'var(--font, system-ui, sans-serif)',
          boxSizing: 'border-box'
        }}>
          <div style={{
            maxWidth: '520px',
            width: '100%',
            background: 'var(--tone-10, #16201b)',
            border: '1px solid var(--tone-25, #24352d)',
            borderRadius: '16px',
            padding: '32px',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px'
          }}>
            <div style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              background: 'color-mix(in srgb, var(--mint, #a5eac8) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--mint, #a5eac8) 35%, transparent)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--mint, #a5eac8)'
            }}>
              <ShieldAlert size={28} />
            </div>
            
            <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0, letterSpacing: '-0.3px' }}>
              MicoCode recovered safely
            </h2>
            
            <p style={{ fontSize: '13px', color: 'var(--tone-65, #9fb3a7)', margin: 0, lineHeight: 1.6 }}>
              A display hiccup was caught and contained. Your project code and local storage are safe and intact.
            </p>

            {this.state.error?.message && (
              <div style={{
                width: '100%',
                maxHeight: '120px',
                overflow: 'auto',
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'var(--tone-15, #1d2a23)',
                border: '1px solid var(--tone-20, #283a30)',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: 'var(--tone-75, #c0d4c8)',
                textAlign: 'left',
                boxSizing: 'border-box'
              }}>
                {this.state.error.message}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px', width: '100%', justifyContent: 'center' }}>
              <button
                type="button"
                className="secondary"
                onClick={this.handleReset}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 16px',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                <RotateCcw size={14} />
                <span>Restore Workspace</span>
              </button>
              
              <button
                type="button"
                className="primary"
                onClick={this.handleReload}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 18px',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                <RefreshCw size={14} />
                <span>Reload Page</span>
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
