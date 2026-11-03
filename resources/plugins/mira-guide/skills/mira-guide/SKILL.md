---
name: mira-guide
description: 回答 Mira 产品的任务、项目、输入区、文件、插件能力、MCP、Hook、自动化、工作流、模型、权限与故障排查问题。
---

# Mira 使用指南

本 Skill 只解释 Mira 当前已经实现的产品能力。不要把开发计划、设计稿或其他产品的行为写成 Mira 已支持。

## 取证顺序

1. 当前界面、宿主工具返回和当前代码行为。
2. 当前测试与工具契约。
3. 本 Skill 的参考文件。

若当前界面或工具结果与参考文件冲突，以当前结果为准，并明确说明差异；无法确认时说“不确定”，不要猜菜单、入口或能力。

## 选择参考文件

按问题只读取必要文件；跨主题问题可以组合读取：

- 任务、项目、个人工作区、多源文件夹、主要目录、信任确认、任务能力快照：读取 [references/tasks-and-projects.md](references/tasks-and-projects.md)。
- 输入区触发符、文件或对话引用、附件、命令、Skill、Agent、MCP、模型、推理、权限、计划模式：读取 [references/composer-and-context.md](references/composer-and-context.md)。
- 插件市场、安装、启停、移除、更新，以及 Skill、Command、Agent、MCP、Hook 的区别：读取 [references/plugins-and-capabilities.md](references/plugins-and-capabilities.md)。
- 文件树、搜索、忽略规则、预览、加入对话、工作区边界：读取 [references/files-and-workspace.md](references/files-and-workspace.md)。
- 自动化任务、立即运行、运行历史、工作流创建、审阅、保存和运行：读取 [references/automations-and-workflows.md](references/automations-and-workflows.md)。
- 模型供应商、默认权限、Hook 信任、本地数据与安全边界：读取 [references/settings-and-security.md](references/settings-and-security.md)。
- 用户描述失败、不可用、消失、无法连接或无法预览时：读取 [references/troubleshooting.md](references/troubleshooting.md)，并按现象补读对应主题文件。

使用 `read_plugin_resource` 读取这些相对路径。不要尝试 Skill 目录外的路径。

## 回答要求

给出可执行答案，至少包含：

1. **入口**：使用当前界面中的准确名称。
2. **步骤**：按实际点击或输入顺序说明。
3. **前置条件**：项目、模型、启用状态、会话选择、授权或信任等。
4. **边界**：说明只影响当前会话还是新任务，哪些格式或状态不支持。
5. **排错**：问题未解决时给出下一处检查入口和可观察状态。

区分“已安装”“已启用”“属于当前任务能力快照”“已在当前会话选择”“已连接或已授权”；它们不是同一状态。涉及删除、完全访问、Hook 或外部服务时，先提示影响与信任边界。
