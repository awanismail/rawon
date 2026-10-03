# Design: Custom DevTools Host (`DEVTOOLS_HOST`)

Status: **Accepted** — brainstormed & validated on 2026-10-03.

## Understanding Summary

- Add the ability to customize the **host/IP shown in DevTools login URLs** (inspect URL,
  debug URL, and the `login start` fallback text) via a new static env var `DEVTOOLS_HOST`.
- Motivation: the bot runs on a remote server (VPS/Docker). URLs currently hardcode
  `127.0.0.1`, which cannot be opened from the developer's machine.
- Audience: bot developer/owner only (the `login` command is gated by the `DevOnly`
  precondition).
- Default behavior: empty `DEVTOOLS_HOST` falls back to `127.0.0.1` (identical to today).
- Port stays configurable via the existing `DEVTOOLS_PORT` (default `3000`).
- Security posture: no new authentication; a warning is logged when a remote host is set.
- Non-goals: ❌ public-IP auto-detection, ❌ token auth, ❌ changing the proxy bind address
  (stays `0.0.0.0`), ❌ IPv6 support, ❌ touching the login/cookie mechanism itself.

## Assumptions

1. `DEVTOOLS_HOST` contains a hostname or IPv4 **without** scheme or port
   (e.g. `bot.example.dev`, `203.0.113.5`) — not a full URL.
2. Internal connections (fetch `/json`, proxy → Chrome) keep using `127.0.0.1`; only
   *displayed* URLs use the custom host. The bot must work even if the public host is
   unreachable from the server itself.
3. The `ws=` parameter inside the inspect URL uses the custom host too (required — the
   DevTools frontend connects via WebSocket to that host).
4. The fallback path in `LoginCommand` (`localhost:{port}`) also uses the custom host.
5. Invalid values (e.g. containing `http://`, `:port`, spaces, trailing dot) fall back to
   `127.0.0.1` with no crash.

## Decision Log

| # | Decision | Alternatives considered | Why |
|---|----------|------------------------|-----|
| D1 | Customize display host only, not the proxy bind address | Also customize bind address | Use case is bot-on-remote-server; bind stays `0.0.0.0` as today |
| D2 | Static env var `DEVTOOLS_HOST`, fallback `127.0.0.1` | Auto-detect public IP; hybrid | Deterministic, no new failure points (NAT/Docker would break detection) |
| D3 | No auth; warning log when a remote host is set | Token auth in proxy; default bind `127.0.0.1` | Personal bot; port expected to be protected by firewall/SSH tunnel |
| D4 | No IPv6 support | Bracket-aware host parsing | Explicitly not needed by the owner |
| D5 | Approach A: pass host via 3rd constructor param + centralized URL helper | (B) string-rewrite URLs in the presentation layer; (C) options-object constructor refactor | Smallest diff, no behavior change when unset; B is fragile (`ws=` rewriting, `getSessionInfo()` returns wrong host elsewhere); C violates YAGNI |
| D6 | Port customization stays on the existing `DEVTOOLS_PORT` — no new var | A combined `DEVTOOLS_URL`/`DEVTOOLS_ADDR` single var | Port is already fully wired via env; splitting host/port keeps backward compatibility |
| D7 | `LoginCommand` fallback derives its port from `debugUrl` / env `devtoolsPort` | Keep the current hardcoded `"4000"` | `4000` is a stale magic number inconsistent with the real default (`3000`); env is the single source of truth |

## Final Design

### 1. Configuration layer

`src/config/env.ts` — alongside the existing `devtoolsPort`:

```ts
const rawDevtoolsHost = process.env.DEVTOOLS_HOST?.trim().toLowerCase() ?? "";
// hostname / IPv4 only — no scheme, port, or IPv6 brackets
export const devtoolsHost = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/u.test(rawDevtoolsHost)
    ? rawDevtoolsHost
    : "127.0.0.1";
```

- Empty/invalid → fallback `127.0.0.1`, no crash.
- `env.ts` stays logger-free; logging lives in the manager.
- Input is lowercased (hostnames are case-insensitive; keeps URLs consistent).

`dev.env.example` — document the new var:

```env
# Public host/IP shown in DevTools login URLs (for remote/headless servers)
# Leave empty to use 127.0.0.1 (local only)
# Example: 203.0.113.5, login.botku.dev
DEVTOOLS_HOST=""
```

### 2. `GoogleLoginManager`

Constructor gains a third parameter:

```ts
public constructor(chromiumPath?: string, devtoolsPort = 3000, devtoolsHost = "127.0.0.1")
```

Security warning (once, at instantiation — D3):

```ts
if (this.devtoolsHost !== "127.0.0.1" && this.devtoolsHost !== "localhost") {
    container.logger.warn(
        `[GoogleLogin] DEVTOOLS_HOST="${this.devtoolsHost}" — DevTools proxy has no authentication. ` +
            "Restrict access with a firewall or SSH tunnel.",
    );
}
```

Two helpers separate display URLs from local ones:

```ts
private getDisplayBaseUrl(): string {
    return `http://${this.devtoolsHost}:${this.actualPort ?? this.devtoolsPort}`;
}

private getLocalBaseUrl(): string {
    return `http://127.0.0.1:${this.actualPort ?? this.devtoolsPort}`;
}
```

Touch points (the only places that currently hardcode `127.0.0.1` for display):

| Location | Change |
|---|---|
| `getDevtoolsBaseUrl()` | `return this.getDisplayBaseUrl()` |
| `buildInspectUrl()` | fetch `/json` stays local; result → `${displayBase}/devtools/inspector.html?ws=${host}:${port}/devtools/page/${id}` |
| `navigateToLoginPage()` | same pattern: local fetch, display-host inspect URL |

Unchanged on purpose (always local): `waitForLogin()`, `connectPuppeteerAndExportCookies()`,
`startDevtoolsProxy()`.

### 3. Wiring

`CookiesManager.ts`:

```ts
sharedLoginManager = new GoogleLoginManager(chromiumPath, devtoolsPort, devtoolsHost);
```

`LoginCommand.ts` fallback stops hardcoding `localhost` and the stale `4000` port
(`URL.host` is `hostname:port`; the display URL always carries an explicit port):

```ts
import { devtoolsPort } from "../../config/env.js";

const debugUrl = sessionInfo.debugUrl ?? "";
const fallbackTarget = debugUrl ? new URL(debugUrl).host : `127.0.0.1:${devtoolsPort}`;
```

### 4. Testing strategy

No test runner in this project — static + manual verification:

1. `pnpm lint` (biome) and `pnpm tscompile`.
2. Manual matrix:

| `DEVTOOLS_HOST` | Expected |
|---|---|
| empty | All URLs show `127.0.0.1:{port}` — regression-free |
| `203.0.113.5` / `login.botku.dev` | `debugUrl`, `inspectUrl`, `ws=` param, and command fallback show the custom host; login flow still succeeds |
| `https://x` / `host:3000` / `my host` | Fallback `127.0.0.1`, bot runs normally |

3. Security warning appears in logs only for remote hosts.

### Edge cases

- Uppercase host → normalized to lowercase.
- `localhost` → accepted by the regex, treated as local (no warning).
- `actualPort` is always set to `DEVTOOLS_PORT` after proxy start → displayed port is deterministic.
