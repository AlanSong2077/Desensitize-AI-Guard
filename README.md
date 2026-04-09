<p align="center">
  <img src="docs/banner.png" width="100%" alt="Data Guard Banner"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-2.2.1-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/Plugin_ID-data--guard-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/Engine-Pure_Node.js--zero_deps-green?style=flat-square" />
  <img src="https://img.shields.io/badge/Platform-macOS_Linux_Windows-black?style=flat-square" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" />
</p>

---

## 🎯 Overview

**Data Guard** is a four-layer data desensitization plugin for OpenClaw. It intercepts outbound AI requests at **four independent layers** — HTTP proxy, file tool hook, Python exec hook, and Shell exec hook — ensuring that personal and sensitive information is masked on your machine **before** being sent upstream.

| | |
|---|---|
| Version | 2.2.1 |
| Plugin ID | `data-guard` |
| Engine | Pure Node.js — zero external dependencies |
| Platform | macOS · Linux · Windows |
| License | MIT |

---

## ⚡ Architecture

<p align="center">
  <img src="docs/arch.png" width="100%" alt="Data Guard Architecture Diagram"/>
</p>

| Layer | Trigger | What it covers |
|:------|:--------|:---------------|
| 🟣 **L4: Shell Exec** | `exec` / `process` — shell commands | `cat` · `awk` · `sed` · `grep` · `head` · `tail` · `node` · `ruby` · `R` · `perl` · `jq` · `sqlite3` · 50+ commands |
| 🟡 **L3: Python Exec** | `exec` / `process` — Python commands | `pd.read_csv` · `pd.read_excel` · `polars` · `open(file)` · `csv.reader` · `python3 script.py` |
| 🟢 **L2: File Tool** | `read`, `read_file`, `read_many_files` | CSV / XLSX / XLS / DOCX / PPTX / PDF with column-level precision |
| 🔵 **L1: HTTP Proxy** | Every outbound `POST /v1/*` API call | All message text sent to the model — ultimate safety net |

> All four layers share the **same desensitization engine** with identical rules. No duplicated logic, no inconsistency.

---

## 🔄 Request Processing Workflow

<p align="center">
  <img src="docs/workflow.png" width="90%" alt="Data Guard Workflow Diagram"/>
</p>

---

## 🛡️ Supported Data Types

**30+ categories** of sensitive data are recognized and masked:


---

## 🚀 Quick Start

```bash
# 1. Clone and pack
git clone https://github.com/AlanSong2077/openclaw-plugins-data-guard.git
cd openclaw-plugins-data-guard
npm pack

# 2. Install into OpenClaw
openclaw plugins install data-guard-2.2.1.tgz

# 3. Restart the gateway
openclaw gateway restart

# 4. Verify
openclaw plugins list
# data-guard   loaded   2.2.1 ✅
```

---

## ⚙️ Configuration

| Option | Type | Default | Description |
|:-------|:-----|:--------|:------------|
| `port` | integer | `47291` | Port the local HTTP proxy listens on |
| `blockOnFailure` | boolean | `true` | Block request if desensitization fails |
| `fileGuard` | boolean | `true` | Enable Layer 2 file desensitization |
| `pythonGuard` | boolean | `true` | Enable Layer 3 Python exec desensitization |
| `shellGuard` | boolean | `true` | Enable Layer 4 Shell exec desensitization |
| `skipPrefix` | string | `[skip-guard]` | Prepend to bypass text desensitization (L1 only) |

### Environment Variables

| Variable | Default | Description |
|:---------|:--------|:------------|
| `DATA_GUARD_PORT` | `47291` | Proxy port (overrides plugin config) |
| `DATA_GUARD_BLOCK_ON_FAILURE` | `true` | Fail-safe mode |
| `OPENCLAW_DIR` | `~/.openclaw` | OpenClaw config directory |

---

## 🔄 Orphan Process Protection

The proxy runs as a **child process** of the gateway. Two mechanisms ensure it never becomes orphaned:

| Mechanism | Side | Description |
|:----------|:-----|:------------|
| ❤️ **Heartbeat** | Proxy | Every 5 s checks parent via `process.kill(ppid, 0)`. Shuts down if parent is gone. |
| 🧹 **PID Cleanup** | Plugin | On every `start()`, kills stale process before spawning a new one. |
| 🗑️ **Legacy Cleanup** | Plugin | On every `register()`, removes hooks from older Data Guard versions to prevent conflicts. |

---

## ⏭️ Skipping Desensitization

To send a message **without** Layer 1 text desensitization, prefix it with `[skip-guard]` (configurable).

> ⚠️ Layers 2, 3, and 4 (file / Python / Shell exec) are **unaffected** by this prefix.


---

## 🛠️ Extending Data Guard

Data Guard supports extending with custom file formats and exec plugins. See the source code in `src/plugins/` for implementation patterns.

---

## 🔧 Troubleshooting

**Port 47291 already in use** — In v2.2.1, stale proxy processes are automatically cleaned up on every `start()`. If needed, use `lsof -i :47291` to find and kill the process, then restart the gateway.

**Plugin not loading** — Try reinstalling: `openclaw plugins uninstall data-guard --force` then `openclaw plugins install data-guard-2.2.1.tgz`.

**Check proxy logs** — `tail -f ~/.openclaw/data-guard/proxy.log`

**Shell exec layer not triggering**

Ensure `shellGuard` is not set to `false` in your plugin config. The Shell exec layer only intercepts `exec` and `process` tool calls — it does not affect direct `read` / `read_file` calls (those are handled by L2).

---

## 📋 Changelog

### v2.2.1
- **NEW** Layer 4 — Shell Exec desensitization (`ShellExecPlugin`)
  - Covers `cat` / `head` / `tail` / `awk` / `sed` / `grep` / `cut` / `sort` / `wc` / `diff` and 40+ more shell commands
  - Covers `node` / `ruby` / `Rscript` / `perl` / `php` / `lua` / `julia` and other language runtimes
  - Covers data tools: `jq` / `yq` / `sqlite3` / `csvkit` / `xsv` / `miller`
  - Shared `execUtils.js` with Python layer — path extraction and desensitize logic deduplicated
- **NEW** `shellGuard` config option (default `true`)
- Updated plugin manifest version to `2.2.1`

### v2.1.0
- Added Layer 3 — Python Exec desensitization (`PythonExecPlugin`)
- Added `pythonGuard` config option
- Added `migrate/cleanLegacy.js` — removes hooks from older versions on install

### v2.0.6
- Added Layers 1 & 2: HTTP Proxy + File Tool desensitization
- Added orphan-proof heartbeat for proxy process
- Support for DOCX / PPTX / PDF parsing (zero deps)

---

## 🤝 Contributing

- **keyuzhang838-dotcom** — contributed the Hook Plugins module

---

## 👥 Authors

| | |
|:--|:--|
| **Alan Song** | Lead Developer |
| **Roxy Li** | Contributor |

---

## 📄 License

MIT License

---

<p align="center">
  <strong>🛡️ Your data stays on your machine — always</strong>
  <br><br>
  <img src="https://img.shields.io/badge/OpenClaw-Plugin-blueviolet?style=for-the-badge&logo=robot" />
  <img src="https://img.shields.io/badge/Node.js-Pure_JS-green?style=for-the-badge&logo=nodedotjs" />
  <img src="https://img.shields.io/badge/Zero_Dependencies-green?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Four_Layers-v2.2.1-purple?style=for-the-badge" />
</p>

<p align="center">
  <sub>Built for privacy · Designed for security</sub>
</p>
