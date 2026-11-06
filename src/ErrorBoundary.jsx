import React from "react";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorId: "" };
  }

  static getDerivedStateFromError() {
    return { hasError: true, errorId: Math.random().toString(36).slice(2, 9) };
  }

  componentDidCatch(error, info) {
    // Keep diagnostics local; never render stack traces to visitors.
    console.error("[downly-ui-error]", this.state.errorId, error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorId: "" });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="grid min-h-screen place-items-center bg-[#060914] px-5 text-slate-100">
        <section role="alert" aria-live="assertive" className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-7 shadow-2xl">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-300">!</div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose-300">Something went wrong</p>
          <h1 className="mt-3 text-2xl font-bold">Downly couldn't load this screen.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">Your download history is stored locally. Reload the app to recover. Active browser downloads are managed separately by Chrome.</p>
          <p className="mt-4 text-[11px] text-slate-600">Reference: {this.state.errorId}</p>
          <button onClick={this.handleReset} className="mt-6 h-11 w-full rounded-xl bg-white px-4 text-sm font-bold text-slate-950 hover:bg-indigo-100">Reload Downly</button>
        </section>
      </main>
    );
  }
}
