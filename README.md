<div align="center">

<img src="docs/banner.png" width="100%" alt="Data Guard — Four-Layer Data Desensitization Engine for OpenClaw" />

<br/>
<br/>

[![Version](https://img.shields.io/badge/version-2.3.1-6366f1?style=for-the-badge&logo=npm&logoColor=white)](https://github.com/AlanSong2077/Desensitize-AI-Guard)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Zero Deps](https://img.shields.io/badge/dependencies-zero-f59e0b?style=for-the-badge)](package.json)
[![Encryption](https://img.shields.io/badge/AES--256--GCM-reversible-ef4444?style=for-the-badge&logo=gnuprivacyguard&logoColor=white)](#reversible-encryption-mode)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-plugin-8b5cf6?style=for-the-badge)](https://openclaw.ai)

<br/>

**English** · [中文](#中文文档)

<br/>

> *Your data stays on your machine — always.*
> *您的数据永远留在本地。*

</div>

---

## Table of Contents · 目录

- [Overview · 概述](#overview--概述)
- [Architecture · 架构](#architecture--架构)
- [How It Works · 工作原理](#how-it-works--工作原理)
- [Reversible Encryption Mode · 可逆加密模式](#reversible-encryption-mode--可逆加密模式)
- [Protected Data Types · 保护数据类型](#protected-data-types--保护数据类型)
- [Quick Start · 快速开始](#quick-start--快速开始)
- [Configuration · 配置](#configuration--配置)
- [Changelog · 更新日志](#changelog--更新日志)
- [Authors · 作者](#authors--作者)

---

## Overview · 概述

**Data Guard** is a four-layer privacy enforcement plugin for [OpenClaw](https://openclaw.ai). It intercepts every path through which sensitive data could reach an AI provider — HTTP requests, file reads, Python scripts, and shell commands — and either masks or reversibly encrypts PII before it leaves your machine.

**Data Guard** 是 [OpenClaw](https://openclaw.ai) 的四层隐私保护插件。它拦截敏感数据可能到达 AI 服务商的每一条路径——HTTP 请求、文件读取、Python 脚本、Shell 命令——在数据离开本机之前完成脱敏或可逆加密。

<br/>

| | |
|:--|:--|
| **Plugin ID** | `data-guard` |
| **Version** | `2.3.1` |
| **Engine** | Pure Node.js · Zero external dependencies |
| **Encryption** | AES-256-GCM (reversible mode) |
| **Platforms** | macOS · Linux · Windows |
| **License** | MIT |

---

## Architecture · 架构

<div align="center">
<img src="docs/arch.png" width="88%" alt="Data Guard Four-Layer Protection Architecture" />
<br/>
<sub>Four independent layers share a single desensitization engine · 四层独立防护，共享同一脱敏引擎</sub>
</div>

<br/>

| Layer | Trigger | Coverage · 覆盖范围 |
|:-----:|:--------|:--------------------|
| **L4** Shell Exec | `exec` / `process` (shell) | `cat` · `awk` · `sed` · `node` · `ruby` · `Rscript` · 80+ commands |
| **L3** Python Exec | `exec` / `process` (Python) | `pd.read_csv` · `open()` · `polars` · `csv.reader()` |
| **L2** File Tool | `read` · `read_file` · `read_many_files` | CSV · XLSX · XLS · DOCX · PPTX · PDF |
| **L1** HTTP Proxy | Every outbound API call · 所有出站 API 调用 | All message text · `[skip-guard]` bypass available |

---

## How It Works · 工作原理

<div align="center">
<img src="docs/workflow.png" width="88%" alt="Data Guard Request Processing Workflow" />
<br/>
<sub>Request processing workflow · 请求处理流程</sub>
</div>

<br/>

Every request entering OpenClaw passes through the following decision path:

每一条进入 OpenClaw 的请求都经过以下决策路径：

1. **L1 HTTP Proxy** checks for the `[skip-guard]` bypass prefix. If absent, all outbound POST bodies are scanned. · L1 HTTP 代理检查 `[skip-guard]` 前缀，若无则扫描所有出站请求体。
2. **30+ pattern rules** identify PII across phone numbers, IDs, emails, bank cards, IP addresses, API keys, and more. · 30+ 条规则识别手机号、身份证、邮箱、银行卡、IP、API Key 等敏感数据。
3. In **block mode**, requests containing PII are rejected with `403`. · **阻断模式**下，含敏感数据的请求直接返回 `403`。
4. In **reversible mode**, each PII value is AES-256-GCM encrypted into an opaque token. The token is sent to the LLM; the response is decrypted transparently before reaching the user. · **可逆模式**下，每个敏感值被 AES-256-GCM 加密为不透明 token 发往 LLM，响应返回后自动解密还原。
5. **L2–L4 hooks** apply column-level or content-level desensitization to files and exec outputs before they enter the message context. · **L2–L4 钩子**在文件内容和 exec 输出进入消息上下文前完成列级或内容级脱敏。

---

## Reversible Encryption Mode · 可逆加密模式

<div align="center">
<img src="docs/Professional_technical_archite_2026-04-09T17-49-17.png" width="80%" alt="Reversible Encryption Architecture" />
<br/>
<sub>AES-256-GCM reversible encryption — the LLM only ever sees tokens · LLM 只看到加密 token，永远看不到原始数据</sub>
</div>

<br/>

Reversible mode is the flagship feature introduced in v2.3.0. Unlike block mode, it allows the LLM to reason about the full context while guaranteeing that raw PII never leaves the machine.

可逆加密模式是 v2.3.0 引入的核心特性。与阻断模式不同，它允许 LLM 在完整上下文中推理，同时保证原始 PII 永远不离开本机。

<br/>

**Encryption properties · 加密属性**

| Property | Value |
|:---------|:------|
| Algorithm · 算法 | AES-256-GCM |
| Key derivation · 密钥派生 | `scrypt(password, salt, 32)` |
| IV | 16 random bytes per value · 每个值独立随机 IV |
| Integrity · 完整性 | 16-byte GCM auth tag |
| Token format · Token 格式 | `<ENC>TYPE_timestamp_index</ENC>` |
| Token storage · Token 存储 | In-memory `Map` · cleared on session end |
| Overlap resolution · 重叠去重 | Priority-based greedy dedup (`idCard > bankCard`) |
| Streaming · 流式支持 | SSE `text/event-stream` — per-chunk decryption |

**Enable reversible mode · 启用可逆模式**

```json
// openclaw.json → plugins.entries.data-guard.config
{
  "mode": "reversible",
  "blockOnFailure": false
}
```

```bash
# Or via environment variable · 或通过环境变量
DATA_GUARD_MODE=reversible openclaw gateway restart
```

---

## Protected Data Types · 保护数据类型

**30+ categories** recognized across both block and reversible modes.

两种模式均支持 **30+ 类**敏感数据识别。

<br/>

<div align="center">

| Category · 类型 | Block Output · 阻断输出 | Reversible Output · 可逆输出 |
|:----------------|:------------------------|:-----------------------------|
| 📱 Phone · 手机号 | `138****5678` | `<ENC>PHONE_…</ENC>` |
| 🆔 Chinese ID · 身份证 | `110***…1234` | `<ENC>ID_CARD_…</ENC>` |
| 💳 Bank card · 银行卡 | `6222**…0123` | `<ENC>BANK_CARD_…</ENC>` |
| 📧 Email · 邮箱 | `z***@example.com` | `<ENC>EMAIL_…</ENC>` |
| 🌐 IPv4 / IPv6 | `192.168.*.*` | `<ENC>IP_…</ENC>` |
| 🔐 API Key / Token | `sk-****` | `<ENC>API_KEY_…</ENC>` |
| 🛂 Passport · 护照 | `E*******` | masked |
| 🧾 Tax code · 税号 | `91**…2G` | masked |
| 🔢 Order ID · 订单号 | `DD*****` | masked |
| 👤 Name · 姓名 | `用户_a3f2` | masked |
| 🏠 Address · 地址 | `北京市朝阳区***` | masked |
| 🚗 Plate · 车牌 | `京A·***45` | masked |
| 💰 Amount · 金额 | randomized scale | masked |
| ➕ and 20+ more… | | |

</div>

<br/>

**Column-level precision for structured files · 结构化文件列级精准脱敏**

When reading CSV or Excel files via the file tool hook (L2), Data Guard identifies sensitive columns by header name and applies the appropriate rule — not a blanket regex sweep.

通过文件工具钩子（L2）读取 CSV 或 Excel 时，Data Guard 按列名识别敏感列并应用对应规则，而非全文正则扫描。

---

## Quick Start · 快速开始

```bash
# Clone and build · 克隆并构建
git clone https://github.com/AlanSong2077/Desensitize-AI-Guard.git
cd Desensitize-AI-Guard
npm pack

# Install into OpenClaw · 安装到 OpenClaw
openclaw plugins install data-guard-2.3.1.tgz

# Restart the gateway · 重启网关
openclaw gateway restart

# Verify · 验证安装
openclaw plugins list
# data-guard   loaded   2.3.1 ✅
```

---

## Configuration · 配置

**Plugin options · 插件选项**

| Option | Type | Default | Description · 说明 |
|:-------|:-----|:-------:|:--------------------|
| `port` | `integer` | `47291` | HTTP proxy port · 代理端口 |
| `mode` | `string` | `block` | `block` or `reversible` · 工作模式 |
| `blockOnFailure` | `boolean` | `true` | Block on desensitization error · 脱敏失败时阻断 |
| `fileGuard` | `boolean` | `true` | Enable L2 file hook · 启用文件工具钩子 |
| `pythonGuard` | `boolean` | `true` | Enable L3 Python hook · 启用 Python exec 钩子 |
| `shellGuard` | `boolean` | `true` | Enable L4 Shell hook · 启用 Shell exec 钩子 |
| `skipPrefix` | `string` | `[skip-guard]` | L1 bypass prefix · L1 绕过前缀 |

**Environment variables · 环境变量**

| Variable | Default | Description · 说明 |
|:---------|:-------:|:--------------------|
| `DATA_GUARD_PORT` | `47291` | Proxy port · 代理端口 |
| `DATA_GUARD_MODE` | `block` | `block` or `reversible` |
| `DATA_GUARD_BLOCK_ON_FAILURE` | `true` | Fail-safe toggle · 失败安全开关 |
| `DATA_GUARD_ENCRYPTION_PASSWORD` | *(built-in)* | AES master password · 加密主密码 |

**Orphan process protection · 孤儿进程防护**

The proxy runs as a child process with two independent safeguards:

代理以子进程方式运行，具备两道独立防护：

- **Heartbeat** — every 5 s the proxy checks if its parent is alive via `process.kill(ppid, 0)`; exits automatically if the gateway is gone. · **心跳检测** — 每 5 秒探测父进程是否存活，网关退出后代理自动关闭。
- **PID + port cleanup** — on every `start()`, stale processes are killed by PID file first, then by `lsof -ti :PORT` as fallback. · **PID + 端口清理** — 每次启动时先按 PID 文件清理残留进程，再用 `lsof` 兜底。

---

## Changelog · 更新日志

### v2.3.1
- Fix: `proxy-process.js` was not forwarding `DATA_GUARD_MODE` to `ProxyServer` · 修复：`proxy-process.js` 未将 `DATA_GUARD_MODE` 传递给 `ProxyServer`
- Fix: regex overlap between `idCard` and `bankCard` caused nested / malformed tokens · 修复：`idCard` 与 `bankCard` 正则重叠导致 token 嵌套乱码
- Fix: SSE `text/event-stream` responses were not decrypted in reversible mode · 修复：可逆模式下 SSE 流式响应未解密

### v2.3.0
- New: Reversible Encryption Mode (AES-256-GCM) · 新增：可逆加密模式
- New: `ReversibleGuard` — per-value encryption with in-memory token map · 新增：`ReversibleGuard` 逐值加密引擎
- New: `UnifiedEncryptionGuard` — single entry point for all four layers · 新增：四层统一加密入口
- New: `DATA_GUARD_MODE` environment variable · 新增：`DATA_GUARD_MODE` 环境变量

### v2.2.x
- New: Python exec hook (L3) · 新增：Python exec 钩子
- New: Shell / Node / R exec hook (L4) · 新增：Shell exec 钩子
- New: `cleanLegacy` migration utility · 新增：旧版清理工具

### v2.1.0
- New: DOCX, PPTX, PDF format support · 新增：DOCX / PPTX / PDF 格式支持
- New: `lsof`-based port cleanup fallback · 新增：基于 `lsof` 的端口清理兜底

### v2.0.6
- Initial stable release · 首个稳定版本
- HTTP proxy layer + file tool hook · HTTP 代理层 + 文件工具钩子
- CSV / XLSX / XLS column-level desensitization · CSV / XLSX / XLS 列级脱敏

---

## Authors · 作者

<div align="center">

| | Name | Role |
|:---:|:-----|:-----|
| 🧑‍💻 | **Alan Song** | Developer |
| 👩‍💻 | **Roxy Li** | Developer |
| 🧑‍💻 | **keyuzhang838-dotcom** | Developer |
| 👩‍💻 | **Ayang77777** | Developer |

</div>

---

## 中文文档

> 完整中文说明请参阅上方各章节的中文部分，每节均提供中英双语对照。
>
> Full Chinese documentation is provided inline throughout this README in bilingual format.

---

<div align="center">

<br/>

**🛡️ Your data stays on your machine — always**

**🛡️ 您的数据永远留在本地**

<br/>

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-8b5cf6?style=for-the-badge&logo=robot&logoColor=white)](https://openclaw.ai)
[![Pure Node.js](https://img.shields.io/badge/Pure_Node.js-Zero_Deps-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![AES-256-GCM](https://img.shields.io/badge/AES--256--GCM-Reversible-ef4444?style=for-the-badge&logo=gnuprivacyguard&logoColor=white)](#reversible-encryption-mode)

<br/>

<sub>Built for privacy · Designed for security · 为隐私而生，为安全而设计</sub>

</div>
