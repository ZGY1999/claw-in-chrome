# Local Codex Mode

This fork adds a `Local Codex` path that does not require an OpenAI API key.

The extension can now:

- store Local Codex settings in `chrome.storage.local`
- check a local native host named `com.zgy1999.codex_bridge`
- start and cancel local tasks from the sidepanel
- stream Codex CLI JSON events back into the sidepanel output panel

## How it works

1. `service-worker-loader.js` imports `codex-bridge-worker.js`
2. The background worker connects to the native host over Chrome Native Messaging
3. The native host launches `codex exec --json`
4. The sidepanel listens for `CODEX_BRIDGE_*` runtime messages and renders the output

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

This is a minimal personal-use integration:

- task dispatch goes through `codex exec --json`
- the sidepanel provides a dedicated Local Codex modal
- settings are managed in a separate floating modal on the options page

It does not yet replace the original chat input flow inside the bundled Claw UI.

## Expected setup

1. Load the unpacked extension
2. Note the extension ID from `chrome://extensions`
3. Run `native-host/install-native-host.ps1 -ExtensionId <your-extension-id>`
4. Open the options page and enable `Local Codex`
5. Open the sidepanel and use the `Local Codex` button
