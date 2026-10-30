import React from "react";
import { LoaderCircle } from "lucide-react";

import { useWorkspace } from "./hooks/useWorkspace";
import SignInScreen from "./components/layout/SignInScreen";
import WorkspaceShell from "./components/layout/WorkspaceShell";

/**
 * App = a three-state gate: loading → sign-in → workspace shell.
 * All routing, drawers, toasts and realtime live in WorkspaceShell /
 * SignInScreen; this file only decides which one the session sees.
 */
export default function App() {
  const { data, loading, error, refresh, setData } = useWorkspace();
  const authError = new URLSearchParams(window.location.search).get("authError");

  if (loading) {
    return (
      <div className="loader" role="status">
        <div className="logo">t</div>
        <LoaderCircle className="spin" />
        <span>Preparing your workspace…</span>
      </div>
    );
  }

  if (!data.me) {
    return <SignInScreen authError={authError} error={error} onRetry={refresh} />;
  }

  return <WorkspaceShell data={data} refresh={refresh} setData={setData} />;
}
