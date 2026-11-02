import { Component, type ReactNode } from "react";
import i18n from "../i18n";

/** Props for the error boundary. */
interface Props {
  children: ReactNode;
}

/** Error boundary state, holding the caught error. */
interface State {
  error: Error | null;
}

/** Render-error fallback showing the message and stack, with a retry that re-renders children. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="flex flex-col items-center justify-center h-screen gap-4 p-8"
          style={{ color: "var(--text-primary)", background: "var(--bg-primary)" }}
        >
          <div className="text-lg font-semibold" style={{ color: "var(--danger)" }}>
            {i18n.t("error.somethingWrong")}
          </div>
          <pre
            className="text-xs max-w-xl overflow-auto p-3 rounded"
            style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
          >
            {this.state.error.message}
            {this.state.error.stack && `\n\n${this.state.error.stack}`}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded text-sm font-medium"
            style={{ background: "var(--accent-dim)", color: "white" }}
          >
            {i18n.t("error.tryAgain")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
