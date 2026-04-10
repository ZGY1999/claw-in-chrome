# Local Codex Mode

This fork adds a `Local Codex` path that does not require an OpenAI API key.

The extension can now:

- store Local Codex settings in `chrome.storage.local`
- check a local native host named `com.zgy1999.codex_bridge`
- route the main sidepanel provider flow through a locally authenticated Codex CLI bridge
- stream Codex CLI JSON events back into the sidepanel request adapter

## How it works

1. `service-worker-loader.js` imports `codex-bridge-worker.js`
2. The background worker connects to the native host over Chrome Native Messaging
3. The native host launches `codex exec --json`
4. The sidepanel provider adapter listens for `CODEX_BRIDGE_*` runtime messages and transforms them back into Anthropic-compatible responses

## Files added by this fork

- `codex-bridge-worker.js`
- `codex-bridge-options.js`
- `codex-bridge-sidepanel.js`
- `codex-bridge.css`
- `native-host/codex-native-host.js`
- `native-host/codex-native-host.cmd`
- `native-host/com.zgy1999.codex_bridge.json`
- `native-host/install-native-host.ps1`

## Current scope

This is a personal-use integration:

- task dispatch goes through `codex exec --json`
- settings are managed in a floating modal on the options page
- the original custom-provider pipeline remains available
- Local Codex is surfaced as a managed provider profile instead of a separate sidepanel chat panel

## Expected setup

1. Load the unpacked extension
2. Note the extension ID from `chrome://extensions`
3. Run `native-host/install-native-host.ps1 -ExtensionId <your-extension-id>`
4. Open the options page and enable `Local Codex`
5. Save the Local Codex settings
6. In the provider list, set `Local Codex` as current only when you want the main chat flow to use the local bridge
