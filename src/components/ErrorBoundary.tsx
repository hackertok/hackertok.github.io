import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Link } from 'react-router-dom';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <h1 className="text-xl font-semibold text-foreground mb-2">
              Something went wrong
            </h1>
            <p className="text-muted-foreground mb-4">
              {this.state.error?.message ?? 'An unexpected error occurred'}
            </p>
            <Link
              to="/"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="inline-block px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent-hover transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
