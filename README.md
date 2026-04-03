# data-guard

> Dual-layer data desensitization plugin for OpenClaw. Sensitive data is sanitized locally before it ever reaches an AI API.

---

## Overview

**Data Guard** intercepts outbound AI requests at two independent layers — an HTTP proxy and a tool hook — ensuring that personal and sensitive information is masked on your machine before being sent upstream. No external dependencies. No data leaves your device unmasked.

| | |
|---|---|
| Version | 2.0.4 |
| Plugin ID | `data-guard` |
| Engine | Pure Node.js — zero external dependencies |
| Platform | macOS · Linux · Windows |
| License | MIT |

---

## How It Works

```
Your Machine
┌─────────────────────────────────────────────────┐
│  OpenClaw Gateway                               │
│                                                 │
│  Layer 2 — Tool Hook                            │
│    Intercepts read / read_file / read_many_files│
│    Sanitizes CSV / XLSX / XLS before AI sees it │
│                                                 │
│  Layer 1 — HTTP Proxy (port 47291)              │
│    Intercepts all POST /v1/* requests           │
│    Sanitizes request body before forwarding     │
└─────────────────────────────────────────────────┘
              │  sanitized only
              ▼
        AI Provider API
   (OpenAI / Claude / MiniMax / Qwen …)
```

| Layer | Trigger | What it covers |
|-------|---------|----------------|
| L1: HTTP Proxy | Every outbound API call | All message text sent to the model |
| L2: Tool Hook | `read`, `read_file`, `read_many_files` | CSV / XLSX / XLS / DOCX / PPTX / PDF file contents |

The two layers are complementary. L2 handles file content before it reaches the model — structured files (CSV/XLSX/XLS) use column-level precision, while document files (DOCX/PPTX/PDF) use full-text regex desensitization. L1 catches anything that slips through as free text in the conversation.

---

## Supported Data Types

30+ categories of sensitive data are recognized and masked:

| Category | Example input | Masked output |
|----------|--------------|---------------|
| Phone number | `13812345678` | `138****5678` |
| Chinese ID card | `110101199001011234` | `1101***********1234` |
| Bank card | `6222021234567890123` | `6222**********0123` |
| Email | `user@example.com` | `u***r@example.com` |
| Passport | `E12345678` | `E********` |
| IPv4 / IPv6 | `192.168.1.100` | `192.168.*.*` |
| Tax / credit code | `91310000MA1FL3XH2G` | `91**************2G` |
| Invoice number | `FP1234567890` | `FP***********` |
| Order / transaction ID | `DD2023123456789` | `DD*************` |
| Social security card | `123456789012345678` | `**************5678` |
| Name | `张明伟` | `用户_a3f2` |
| Address | `北京市朝阳区建国路88号` | `北京市朝阳区***` |
| Token / password fields | `Bearer eyJhbGci…` | `Bearer ********` |
| WeChat / QQ ID | `wx_abc123` | `wx_****` |
| Vehicle plate | `京A·12345` | `京A·***45` |
| Amount (scaled) | `¥1,250,000` | `¥937,500` (random scale) |
| … and more | | |

### Column-level desensitization for structured files

When reading CSV or Excel files, Data Guard identifies sensitive columns by header name and applies the appropriate mask per column — not a blanket regex over the whole file.

```
Input (AI never sees this):
姓名,手机号,身份证号,银行卡号,邮箱
张明伟,13812345678,110101199001011234,6222021234567890123,zhang@example.com

Output (what the AI receives):
姓名,手机号,身份证号,银行卡号,邮箱
用户_a3f2,138****5678,1101***********1234,6222**********0123,z***g@example.com
```

---

## Installation

**Prerequisites:** Node.js >= 18, OpenClaw Gateway

```bash
# 1. Clone and pack
git clone https://github.com/your-org/openclaw-plugins-data-guard.git
cd openclaw-plugins-data-guard
npm pack

# 2. Install into OpenClaw
openclaw plugins install data-guard-2.0.4.tgz

# 3. Restart the gateway
openclaw gateway restart

# 4. Verify
openclaw plugins list
# data-guard   loaded   2.0.4
```

---

## Configuration

Configuration is managed through the OpenClaw plugin config system. The following options are available:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | integer | `47291` | Port the local HTTP proxy listens on |
| `blockOnFailure` | boolean | `true` | Block the request if desensitization fails. Set to `false` to fail open (not recommended) |
| `fileGuard` | boolean | `true` | Enable Layer 2 file desensitization |
| `skipPrefix` | string | `[skip-guard]` | Prepend this string to a message to bypass text desensitization for that message |

The proxy also reads two environment variables at startup:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_GUARD_PORT` | `47291` | Proxy port (overrides plugin config) |
| `DATA_GUARD_BLOCK_ON_FAILURE` | `true` | Fail-safe mode |



---

## Orphan Process Protection

The proxy runs as a child process of the gateway. Two mechanisms ensure it never becomes an orphan and block the port on the next startup:

**Heartbeat (proxy side):** Every 5 seconds the proxy checks whether its parent process is still alive using `process.kill(ppid, 0)`. If the parent is gone (`ESRCH`), the proxy shuts itself down and removes its PID file.

**PID file cleanup (plugin side):** On every `start()`, the plugin reads `~/.openclaw/data-guard/proxy.pid` and kills any stale process before spawning a new one. The same cleanup runs on `stop()` as a fallback.

---

## Skipping Desensitization

To send a message without text desensitization (Layer 1), prefix it with `[skip-guard]` (configurable via `skipPrefix`). Layer 2 file desensitization is unaffected by this prefix.

---

## Extending Data Guard

### Adding a new file format

```js
import { FileFormat } from 'data-guard/plugins/tool/formats/FileFormat'
import { registry }   from 'data-guard/plugins/tool/formats'

class OdsFormat extends FileFormat {
  get extensions() { return ['.ods'] }
  parse(buffer)    { /* return { sheets: [{ name, rows }] } */ }
}

registry.register(new OdsFormat())
// FileDesensitizePlugin will automatically handle .ods files
```

### Adding a new tool plugin

```js
import { ToolPlugin } from 'data-guard/plugins/base/ToolPlugin'

class MyPlugin extends ToolPlugin {
  get id()             { return 'my-plugin' }
  get name()           { return 'My Plugin' }
  get supportedTools() { return ['my_tool'] }

  handleToolCall(toolName, params, config, logger) {
    // return { params: modifiedParams } or undefined to pass through
  }
}
```

---

## Project Structure

```
data-guard/
├── index.js                          # Plugin entry — wires all layers together
├── openclaw.plugin.json              # Plugin manifest
├── package.json
└── src/
    ├── core/
    │   └── desensitize.js            # Desensitization engine (30+ rules, zero deps)
    ├── input/
    │   └── FileReader.js             # Reads file → parses → desensitizes → temp file
    ├── output/
    │   └── TempFileManager.js        # Temp file lifecycle management
    ├── proxy/
    │   ├── ProxyServer.js            # HTTP reverse proxy server
    │   ├── UrlRewriter.js            # Rewrites provider baseUrls in openclaw.json
    │   └── proxy-process.js          # Proxy child process entry point
    └── plugins/
        ├── base/
        │   ├── Plugin.js             # Abstract base class for all plugins
        │   └── ToolPlugin.js         # Base class for tool-hook plugins
        ├── ProxyPlugin.js            # HTTP proxy plugin (registerService)
        └── tool/
            ├── FileDesensitizePlugin.js
            └── formats/
                ├── FileFormat.js     # Abstract format + registry
                ├── CsvFormat.js
                ├── XlsxFormat.js
                ├── XlsFormat.js
                ├── DocxFormat.js     # DOCX / DOTX (ZIP + XML, zero deps)
                ├── PptxFormat.js     # PPTX / POTX (ZIP + XML, zero deps)
                ├── PdfFormat.js      # PDF (content stream extraction, zero deps)
                └── index.js
```

---

## Troubleshooting

**Port 47291 already in use**

This should no longer happen in v2.0.4 — the plugin automatically kills any stale proxy process on startup. If it does occur:

```bash
lsof -i :47291        # find the process
kill <PID>            # kill it
openclaw gateway restart
```

**Plugin not loading**

```bash
openclaw plugins list           # check status
openclaw plugins uninstall data-guard --force
openclaw plugins install data-guard-2.0.4.tgz
openclaw gateway restart
```

**Check proxy logs**

```bash
tail -f ~/.openclaw/data-guard/proxy.log
```

---

## Contributing

Pull requests are welcome. Please open an issue first to discuss significant changes.

### Acknowledgements

- **keyuzhang838-dotcom** — contributed the Hook Plugins module

---

## Authors

Alan Song · Roxy Li

---

## License

MIT
