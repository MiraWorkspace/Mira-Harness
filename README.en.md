<div align="center">

<img src="src/asset/mira-logo.png" width="112" alt="Mira" />

# Mira

**A local-first personal AI desktop workspace**

Multiple models · Agent collaboration · Workflow automation · MCP extensions

[简体中文](README.md) · **English**

[Getting started](#getting-started) · [Capabilities](#capabilities) · [Development](#development) · [Feedback and contributions](#feedback-and-contributions)

[![License: MIT](https://img.shields.io/badge/License-MIT-525252?style=flat-square)](LICENSE)
![Desktop: Electron](https://img.shields.io/badge/Desktop-Electron-525252?style=flat-square)

</div>

Mira brings conversations, project files, a terminal, a browser, and tool execution into one workspace. Describe your goal, choose a model and permissions, follow the plan and execution, and approve actions when needed to work through research, writing, file organization, or coding tasks.

Work within a project or start a standalone personal task. Conversations, run history, and workflow outputs persist on your computer so you can return and continue.

## Capabilities

| Capability | What you can do |
| --- | --- |
| **Tasks and agent collaboration** | Organize projects, task groups, and conversations. Review plans, tool calls, and approvals; delegate complex work to subagents and stop execution at any time. |
| **Files and developer tools** | Browse, search, read, and edit project files. Use a terminal, Git tools, and an embedded browser, with code and document previews alongside your conversation. |
| **Documents and writing** | Preview PDFs, Word documents, spreadsheets, and presentations. Use document plugins to create and process content, or work in the built-in novel-writing app. |
| **Workflows and automation** | Compose repeatable workflows, schedule automated tasks, and review run history and artifacts. |
| **Multiple model providers** | Configure online providers, custom compatible endpoints, or local Ollama models. Choose a model for each task, with support for OpenAI Completions, Responses, and Anthropic Messages protocols. |
| **Plugins and MCP** | Extend your tools through plugin marketplaces, Skills, commands, agents, Hooks, and MCP servers. Enable browser interaction and computer control as needed. |
| **Instructions, memory, and remote chat** | Configure instructions and memory. Continue project conversations from another device's browser on a trusted local network while your desktop executes the tasks. |

Task availability depends on the model's tool-use capabilities, the provider's supported protocols, and each plugin's runtime requirements.

## Start with a concrete task

**Organize information**

> Read the meeting notes in this project, extract action items, owners, and open questions, and save them as a Markdown document.

**Work on code**

> Trace how this repository starts up and find its configuration entry points. Propose a change plan and wait for my approval before editing.

**Build a workflow**

> Turn “read the sources, extract key points, and write a report” into a repeatable workflow, keeping the output of each run.

## Getting started

### Get the app

Visit [GitHub Releases](https://github.com/ChatWw/Mira-Harness/releases) for versions, installers, and release notes. If no installer is available yet, you can [run from source](#development).

Current packaging targets:

| Platform | Architecture | Package |
| --- | --- | --- |
| macOS | Apple Silicon (arm64) | DMG |
| Windows | x64 | NSIS installer |

Check each release's attached assets for the platforms actually available.

### Configure your first task

1. Open **Settings → Model services** (`设置 → 模型服务`), add a provider or local Ollama endpoint, and configure and enable a model.
2. Add a project folder or create a task in your personal workspace.
3. Choose a model and permission mode, then describe your goal. Approve file changes or other actions when prompted.
4. Follow execution, file changes, and results in the workspace. Continue the conversation or stop the task as needed.

PDF, Office, and browser plugins may require additional Python libraries, a browser, or other tools. Check the plugin instructions before enabling them. Computer control on macOS also requires the relevant system permissions.

## Local-first and your data

- **Local persistence**: Conversations, configuration, memory, and run history are primarily stored in `.mira` under your home directory. Project files stay in the folders you choose.
- **Your choice of model endpoint**: Requests to online models send task-related messages, attachment content, or tool results to your configured provider. Connect to local Ollama to use local models.
- **External tools when enabled**: Plugins and MCP servers may access networks or other applications. Their data handling depends on the tools you enable.
- **Permissions you control**: Files, commands, and tools use the app's permission and approval mechanisms. See [file access](docs/MIRA_FILE_ACCESS.md) for the specific boundaries.

LAN remote chat is off by default. When enabled, your desktop retains model access and task execution. Use it only on trusted networks; see [remote chat](docs/MIRA_LAN_REMOTE_IMPLEMENTATION.md) for connection details.

## Development

**Mira Harness** is the engineering name of this repository; **Mira** is the application name. The full application runs in Electron.

### Requirements

- Node.js **22.12 or later** and npm.
- On macOS, Xcode Command Line Tools to compile the computer-control helpers.
- Build Windows installers on Windows. Native dependencies require the corresponding platform's build toolchain.

After obtaining the source, run these commands from the repository root:

```bash
npm install
npm run dev
```

The development command builds the React workspace, workflow runtime, and local tools before starting Electron. After editing the React workspace, run `npm run harness:build` and refresh the desktop page.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Prepare resources and start Electron in development mode |
| `npm run build` | Run Vue / React type checks and the full production build |
| `npm test` | Run Vitest regression tests |
| `npm run desktop:build` | Build a macOS arm64 DMG |
| `npm run desktop:build:win` | Build a Windows x64 NSIS installer on Windows |
| `npm run harness:build` | Rebuild the React workspace and remote client |
| `npm run flow:build` | Rebuild the workflow compiler and runtime |
| `npm run tools:build` | Prepare search tools and computer-control helpers |

Both installer commands include type checks and the production build. Native tools are prepared for the target platform and architecture during packaging. Real model calls, native desktop actions, and installers on each platform require separate acceptance checks in addition to unit tests and builds.

### Architecture

Electron handles model calls, agent execution, local files, and storage. React implements the Harness workspace. Vue provides the window shell, shared settings, and entry points for other apps.

```text
apps/harness-react/    React workspace, LAN client, and host bridge
electron/              Main process, preload, IPC, execution, and storage
src/                   Vue shell, settings, novel app, and shared contracts
packages/              Workflow compiler and runtime
resources/             Bundled plugins and runtime resources
scripts/               Build and installation preparation scripts
tests/                 Regression tests
docs/                  Capability and interface documentation
third-party-licenses/  Third-party licenses, notices, and source records
```

## Documentation

The detailed documentation below is currently in Chinese unless otherwise noted.

| Topic | Links |
| --- | --- |
| Product and interface | [Product](PRODUCT.md) · [Design](DESIGN.md) |
| Workspace and app integration | [React workspace](apps/harness-react/README.md) · [First-party SDK](docs/MIRA_FIRST_PARTY_SDK_CONTRACT.md) |
| Models and files | [Built-in model protocols](docs/BUILTIN_MODEL_PROTOCOLS.md) · [File access](docs/MIRA_FILE_ACCESS.md) |
| Tools and extensions | [Embedded browser automation](docs/MIRA_EMBEDDED_BROWSER_AUTOMATION.md) · [Plugin marketplace](docs/MIRA_PLUGIN_MARKETPLACE.md) |
| Remote access | [LAN remote chat](docs/MIRA_LAN_REMOTE_IMPLEMENTATION.md) |

## Feedback and contributions

Report bugs and suggest improvements through [Issues](https://github.com/ChatWw/Mira-Harness/issues), or contribute changes with a pull request. Include the app version, operating system, reproduction steps, and any relevant screenshots or redacted logs.

## License

Original Mira code is licensed under the [MIT License](LICENSE). Third-party code, assets, and dependencies retain their respective licenses. Sources and required notices are recorded in [third-party-licenses](third-party-licenses/README.md) and the relevant plugin directories.
