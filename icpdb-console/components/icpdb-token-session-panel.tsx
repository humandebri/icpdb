"use client";

// icpdb-console/components/icpdb-token-session-panel.tsx
// Token session form: connects the console to the bearer-token HTTP API.

import { KeyRound, Link2Off, PlugZap } from "lucide-react";

export type TokenSessionPanelProps = {
  connected: boolean;
  databaseId: string;
  disabled: boolean;
  httpBaseUrl: string;
  token: string;
  onConnect: () => void;
  onDatabaseIdChange: (value: string) => void;
  onDisconnect: () => void;
  onHttpBaseUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
};

export function TokenSessionPanel(props: TokenSessionPanelProps) {
  const {
    connected,
    databaseId,
    disabled,
    httpBaseUrl,
    token,
    onConnect,
    onDatabaseIdChange,
    onDisconnect,
    onHttpBaseUrlChange,
    onTokenChange
  } = props;

  return (
    <section className="rounded-md border border-[#d5d9e2] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">HTTP token</h3>
        <KeyRound aria-hidden size={16} />
      </div>
      <div className="mt-3 space-y-2">
        <input
          className="w-full rounded-md border border-[#c9ced8] bg-white px-2 py-1.5 font-mono text-xs text-[#182230]"
          placeholder="https://<canister-id>.icp0.io"
          value={httpBaseUrl}
          onChange={(event) => onHttpBaseUrlChange(event.target.value)}
        />
        <input
          className="w-full rounded-md border border-[#c9ced8] bg-white px-2 py-1.5 font-mono text-xs text-[#182230]"
          placeholder="database_id"
          value={databaseId}
          onChange={(event) => onDatabaseIdChange(event.target.value)}
        />
        <input
          className="w-full rounded-md border border-[#c9ced8] bg-white px-2 py-1.5 font-mono text-xs text-[#182230]"
          placeholder="api token"
          type="password"
          value={token}
          onChange={(event) => onTokenChange(event.target.value)}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="inline-flex items-center justify-center gap-2 rounded-md border border-[#2f6fed] bg-[#2f6fed] px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          disabled={disabled}
          type="button"
          onClick={onConnect}
        >
          <PlugZap aria-hidden size={14} />
          <span>{connected ? "Reconnect" : "Connect"}</span>
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-md border border-[#c9ced8] bg-white px-2 py-1.5 text-xs font-medium text-[#182230] disabled:opacity-50"
          disabled={!connected}
          type="button"
          onClick={onDisconnect}
        >
          <Link2Off aria-hidden size={14} />
          <span>Disconnect</span>
        </button>
      </div>
    </section>
  );
}
