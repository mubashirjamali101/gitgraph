import { Component, ReactNode, ErrorInfo } from 'react'
import { log, snapshotRing } from '../utils/log'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error(`ErrorBoundary: ${error.name}: ${error.message}\n${error.stack ?? ''}\n${info.componentStack ?? ''}`)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  private handleCopy = () => {
    const diag = this.buildDiagnostic()
    void navigator.clipboard?.writeText(diag).catch(() => {})
  }

  private handleReload = () => {
    window.location.reload()
  }

  private buildDiagnostic(): string {
    const { error, componentStack } = this.state
    const recent = snapshotRing().slice(-50)
      .map(e => `${new Date(e.ts).toISOString()} ${e.level} ${e.message}`)
      .join('\n')
    return [
      `Error: ${error?.name}: ${error?.message}`,
      `Stack:\n${error?.stack ?? '(none)'}`,
      `Components:\n${componentStack ?? '(none)'}`,
      `Recent log entries:\n${recent}`,
    ].join('\n\n')
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <h2>GitGraph hit an unexpected error.</h2>
          <p className="error-boundary-summary">
            {this.state.error.name}: {this.state.error.message}
          </p>
          <details>
            <summary>Stack trace</summary>
            <pre>{this.state.error.stack ?? '(none)'}</pre>
            {this.state.componentStack && (
              <pre className="error-boundary-stack">{this.state.componentStack}</pre>
            )}
          </details>
          <div className="error-boundary-actions">
            <button onClick={this.handleCopy}>Copy diagnostic</button>
            <button onClick={this.handleReload}>Reload</button>
          </div>
        </div>
      </div>
    )
  }
}
