# Security

Vapi Orca holds a credential that can do anything in a Vapi organization, so security is the main
design constraint. This document says what the plugin promises, how each promise is enforced, and
how you can check it yourself.

## Reporting a vulnerability

Please report security problems privately through GitHub: on this repository, open
**Security → Report a vulnerability**. Do not open a public issue. You should get a reply within a
week. Fixes are released as a new version, and the advisory is published once users can update.

Only the latest release is supported.

## Threat model

| Threat | What could go wrong | Mitigation | Enforced by |
|---|---|---|---|
| Key theft at rest | The key is read from disk by another program or user | Stored only in Orca's encrypted secrets, protected by the OS keyring. The plugin refuses to store a key when `secrets.protection` is not `os-keyring`. | `keystore.ts`, `test/keystore.test.ts` |
| Key exposure in the UI | The key is shown, logged or sent to the panel | Only `http.ts` reads the key, and only into the `Authorization` header. The panel gets a four-character fingerprint. Logs pass through a scrubber. Errors carry fixed messages, never response bodies. | `test/worker.test.ts`, `test/http.test.ts` (every error path checks for the key) |
| Exfiltration | The key or data is sent somewhere other than Vapi | One fixed origin, `https://api.vapi.ai`, with a second check on the final URL. Redirects are refused. Network calls exist only in `src/worker/http.ts`. No other host appears in the source except the dashboard link, which only opens in your browser. | `gate.ts`, `http.ts`, `scripts/audit.mjs` |
| Unintended writes | The plugin changes or deletes something in your Vapi org | A single gate allows `GET` on a fixed list of read endpoints and `POST /analytics`. IDs and query values are validated. Write methods do not appear in the source. | `gate.ts`, `test/gate.test.ts`, `scripts/audit.mjs` |
| Leaking secrets inside configs | Webhook secrets, auth headers or provider tokens in your assistants and tools are shown | A redactor replaces sensitive keys, all header values, credential IDs, URL userinfo and token-like query values before data reaches the panel. | `redact.ts`, `test/redact.test.ts` (fake-secret fixtures must never survive) |
| Persisting customer data | Transcripts or caller numbers end up on disk | Data from Vapi is cached in memory only, for 60 seconds, and cleared on disconnect. The plugin declares no storage capability. The caller's number is masked in call lists, the call header and the raw view. Transcripts and tool arguments are shown as the call happened, so they can contain what the caller said, including a number. | `cache.ts`, `call-parse.ts`, `scripts/audit.mjs` |
| Markup injection | A transcript or config field injects HTML into the panel | All text is set with `textContent`. `innerHTML`, `eval` and `new Function` do not appear in the source. Orca's panel frame also has no network access. | `scripts/audit.mjs` |
| Oversized or hostile responses | A huge or malformed answer hangs or crashes the worker | 4 MiB response cap, 10 s timeout, at most 2 requests at once, capped retries on 429, defensive parsing that never throws on odd input. | `http.ts`, `test/http.test.ts`, `test/call-parse.test.ts` |
| Supply chain | A dependency is compromised | No runtime dependencies. The only dev dependency is `typescript`, pinned exactly; `.npmrc` disables install scripts. No build step, so the committed source is what runs. | `package.json`, `.npmrc`, `scripts/audit.mjs` |
| Secrets committed to the repository | A real key lands in git | gitleaks scans every push and pull request. Its allowlist contains only the exact fake values the tests use. | `.github/workflows/ci.yml`, `.gitleaks.toml` |

## Known limitations

- **Vapi private keys are all-powerful.** Vapi does not offer read-only or scoped private keys. Vapi
  Orca only reads, but the key itself could do more. Use a dedicated or development organization
  if you can.
- **The worker is a normal program.** Orca runs `trusted-worker` plugins as a Node.js process with your
  user account's access; Orca labels it "Full access". Vapi Orca's worker uses no file-system,
  process or raw-socket APIs, which `scripts/audit.mjs` checks, but you are trusting this code. It is
  small so that you can read it.
- **Orca's own access model.** Orca lets a plugin's panel call the secrets API too. Vapi Orca's panel
  never does, and the audit fails the build if it tries.
- **Recording links** are opened in your browser. Anyone with the link can fetch the recording, as
  with any Vapi recording URL.

## Check it yourself

1. **Read the worker.** `src/worker/` is the only code that touches the key or the network. Start
   with `gate.ts` and `http.ts`.
2. **Run the checks.** `npm run check` runs the security audit, the typecheck, the tests and Orca's
   validator.
3. **Watch the traffic.** The panel's **Network activity** section, or **Vapi: Show network
   activity**, lists every request the plugin made.
4. **See where the key is.** Orca keeps it in an encrypted file in its own data folder, for example
   `%APPDATA%\orca\plugins-data\<plugin-key>\secrets.json.enc` on Windows. Never in the project
   folder.
5. **Read Orca's audit log.** Orca, not the plugin, records each secret write in
   `plugins-data/audit.log` with only the slot name, for example
   `secrets.set key=vapi-api-key`.
