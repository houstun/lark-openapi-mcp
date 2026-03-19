# 飞书/Lark OpenAPI MCP

[![npm version](https://img.shields.io/npm/v/@larksuiteoapi/lark-mcp.svg)](https://www.npmjs.com/package/@larksuiteoapi/lark-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@larksuiteoapi/lark-mcp.svg)](https://www.npmjs.com/package/@larksuiteoapi/lark-mcp)
[![Node.js Version](https://img.shields.io/node/v/@larksuiteoapi/lark-mcp.svg)](https://nodejs.org/)

中文 | [English](./README.md) 

[开发文档检索 MCP](./docs/recall-mcp/README_ZH.md) 

[官方文档](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction)

[常见问题](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/use_cases)

> **⚠️ Beta版本提示**：当前工具处于Beta版本阶段，功能和API可能会有变更，请密切关注版本更新。

飞书/Lark官方 OpenAPI MCP（Model Context Protocol）工具，旨在帮助用户快速连接飞书平台并实现 AI Agent 与飞书的高效协作。该工具将飞书开放平台的 API 接口封装为 MCP 工具，使 AI 助手能够直接调用这些接口，实现文档处理、会话管理、日历安排等多种自动化场景。

## 使用准备

### 创建应用

在使用lark-mcp工具前，您需要先创建一个飞书应用：

1. 访问[飞书开放平台](https://open.feishu.cn/)并登录
2. 点击"开发者后台"，创建一个新应用
3. 获取应用的App ID和App Secret，这将用于API认证
4. 根据您的使用场景，为应用添加所需的权限
5. 如需以用户身份调用API，请设置OAuth 2.0重定向URL为 http://localhost:3000/callback

详细的应用创建和配置指南，请参考[飞书开放平台文档 - 创建应用](https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process#a0a7f6b0)。

### 安装Node.js

在使用lark-mcp工具之前，您需要先安装Node.js环境。

**使用官方安装包（推荐）**：

1. 访问[Node.js官网](https://nodejs.org/)
2. 下载并安装LTS版本
3. 安装完成后，打开终端验证：

```bash
  node -v
  npm -v
```

## 快速开始

### 在Trae/Cursor中使用

如需在Trae、Cursor等AI工具中集成飞书/Lark功能，你可以通过下方按钮安装，将 `app_id` 和 `app_secret` 填入安装弹窗或客户端配置 JSON 的 `args` 中：

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-light.svg)](https://cursor.com/install-mcp?name=lark-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBsYXJrc3VpdGVvYXBpL2xhcmstbWNwIiwibWNwIiwiLWEiLCJ5b3VyX2FwcF9pZCIsIi1zIiwieW91cl9hcHBfc2VjcmV0Il19)
[![Install MCP Server](./assets/trae-cn.svg)](trae-cn://trae.ai-ide/mcp-import?source=lark&type=stdio&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBsYXJrc3VpdGVvYXBpL2xhcmstbWNwIiwibWNwIiwiLWEiLCJ5b3VyX2FwcF9pZCIsIi1zIiwieW91cl9hcHBfc2VjcmV0Il19)  [![Install MCP Server](./assets/trae.svg)](trae://trae.ai-ide/mcp-import?source=lark&type=stdio&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBsYXJrc3VpdGVvYXBpL2xhcmstbWNwIiwibWNwIiwiLWEiLCJ5b3VyX2FwcF9pZCIsIi1zIiwieW91cl9hcHBfc2VjcmV0Il19)


也可以直接在 MCP Client 的配置文件中添加以下内容（JSON），客户端会按配置启动 `lark-mcp`：

```json
{
  "mcpServers": {
    "lark-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@larksuiteoapi/lark-mcp",
        "mcp",
        "-a",
        "<your_app_id>",
        "-s",
        "<your_app_secret>"
      ]
    }
  }
}
```

如需使用**用户身份**访问 API：
1) 在终端运行 `login`（会保存令牌，后续客户端可直接复用）。
2) 在 MCP Client 配置中加入 `--oauth`。

注意需要先在开发者后台配置应用的重定向 URL，默认是 `http://localhost:3000/callback`。

```bash
npx -y @larksuiteoapi/lark-mcp login -a cli_xxxx -s yyyyy
```

然后在 MCP Client 中启用 `--oauth`

```json
{
  "mcpServers": {
    "lark-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@larksuiteoapi/lark-mcp",
        "mcp",
        "-a", "<your_app_id>",
        "-s", "<your_app_secret>",
        "--oauth",
        "--token-mode", "user_access_token"
      ]
    }
  }
}
```

说明：在启用 `--oauth` 时，建议显式设置 `--token-mode` 为 `user_access_token`，表示以用户访问令牌调用 API，适用于访问用户资源或需要用户授权的场景（如读取个人文档、发送 IM 消息）。若保留默认 `auto`，可能在AI推理使用 `tenant_access_token`，导致权限不足或无法访问用户私有数据。

### 域名配置

根据您的使用场景，lark-mcp 支持配置不同的域名环境：

**飞书**：
- 默认使用 `https://open.feishu.cn` 域名
- 适用于飞书用户

**Lark（国际版）**：
- 使用 `https://open.larksuite.com` 域名
- 适用于国际版Lark用户

如需切换至国际版Lark，请在配置中添加 `--domain` 参数：

```json
{
  "mcpServers": {
    "lark-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@larksuiteoapi/lark-mcp",
        "mcp",
        "-a",
        "<your_app_id>",
        "-s",
        "<your_app_secret>",
        "--domain",
        "https://open.larksuite.com"
      ]
    }
  }
}
```

> **💡 提示**：确保您的应用已在对应域名环境的开放平台创建。国际版应用无法在飞书中国版使用，反之亦然。

## 环境配置指南

接入前建议先根据实际使用场景确认环境配置方式：

| 场景 | 要求 | 推荐配置方式 |
|---|---|---|
| 飞书中国版环境 | 应用创建于 `open.feishu.cn` | 设置 `LARK_DOMAIN=https://open.feishu.cn` 或传 `--domain https://open.feishu.cn` |
| Lark 国际版环境 | 应用创建于 `open.larksuite.com` | 设置 `LARK_DOMAIN=https://open.larksuite.com` 或传 `--domain https://open.larksuite.com` |
| 仅使用应用身份 | 应用已开通所需应用权限 | 使用默认 `tokenMode=auto`，或显式设置 `tenant_access_token` |
| 需要用户身份访问 | 已配置 OAuth 重定向地址，应用已开通用户权限范围 | 先执行 `login`，再用 `--oauth --token-mode user_access_token` 启动 |
| 直接使用 npm 官方包 | Node.js `>=20`，本机有 npm | 使用 `npx -y @larksuiteoapi/lark-mcp ...` 启动 |
| 使用本地源码或自定义 fork | Node.js `>=20`，执行过 `npm install` 和 `npm run build` | 使用仓库内的本地启动脚本 |

### 本地源码 / Fork 配置

这个 fork 已附带适用于 macOS/Linux 的本地启动脚本：

1. 拉取代码并安装依赖：

```bash
git clone <your-fork-url>
cd lark-openapi-mcp
npm install
npm run build
```

2. 基于 [`.env.local.example`](./.env.local.example) 创建本地环境文件：

```bash
cp .env.local.example .env.local
```

3. 在 `.env.local` 中填写最少配置：

```env
APP_ID=cli_xxxx
APP_SECRET=your_secret
LARK_DOMAIN=https://open.feishu.cn
LARK_TOOLS=preset.doc.default
LARK_TOKEN_MODE=auto
```

4. 从本地源码启动 MCP：

```bash
./scripts/lark-mcp-local.sh mcp
```

如果是 Windows，建议先构建再直接运行 CLI：

```bash
npm install
npm run build
node dist/cli.js mcp
```

### 本地 MCP Client 配置

如果希望 Cursor、Claude Desktop 或其他 MCP 客户端直接使用本地 fork，而不是 npm 上的已发布版本，可以这样配置：

```json
{
  "mcpServers": {
    "lark-mcp-local": {
      "command": "/absolute/path/to/lark-openapi-mcp/scripts/lark-mcp-local.sh",
      "args": ["mcp"]
    }
  }
}
```

Windows 环境可改为直接调用构建后的 CLI：

```json
{
  "mcpServers": {
    "lark-mcp-local": {
      "command": "node",
      "args": ["C:\\path\\to\\lark-openapi-mcp\\dist\\cli.js", "mcp"]
    }
  }
}
```

### 常用环境变量

最常见的环境变量如下：

- `APP_ID`：飞书/Lark 应用 ID
- `APP_SECRET`：飞书/Lark 应用 Secret
- `LARK_DOMAIN`：`https://open.feishu.cn` 或 `https://open.larksuite.com`
- `LARK_TOOLS`：preset 名称或逗号分隔的工具列表，例如 `preset.doc.default`
- `LARK_TOKEN_MODE`：`auto`、`tenant_access_token` 或 `user_access_token`
- `USER_ACCESS_TOKEN`：可选，适合调试场景下直接注入用户令牌

### 用户 OAuth 配置

如果需要读取个人文档、以用户身份发送消息、访问用户私有资源，建议按下面方式配置：

1. 在开发者后台配置重定向 URL，默认是 `http://localhost:3000/callback`
2. 本地执行登录：

```bash
npx -y @larksuiteoapi/lark-mcp login -a cli_xxxx -s your_secret
```

3. 启动 MCP 时启用 OAuth：

```bash
npx -y @larksuiteoapi/lark-mcp mcp -a cli_xxxx -s your_secret --oauth --token-mode user_access_token
```

> **安全提示**：请不要把 `.env.local`、用户令牌或应用密钥提交到 Git。当前仓库默认已忽略 `.env*` 文件。


## 自定义配置开启API

> ⚠️ **云文档编辑**：当前 fork 已支持基于官方 API 的“尽力而为”原地更新能力，包括 `docx.builtin.update` 和支持覆盖模式的 `docx.builtin.markdownWrite`。实现方式是先抓取官方 Markdown，再在 Markdown 层应用变更，最后通过官方块接口重写顶层内容块。复杂嵌套结构可能会被规范化。标题更新目前在 docx 挂载到 Wiki 时可通过 `wiki.v2.spaceNode.updateTitle` 生效；独立 docx 的标题仍受官方 Docx API 限制，暂不支持直接更新。

默认情况下，MCP 服务启用常用 API。如需启用其他工具或仅启用特定 API 或 preset，推荐在 MCP Client 配置（JSON）中通过 `-t` 指定（用逗号分隔）：

```json
{
  "mcpServers": {
    "lark-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@larksuiteoapi/lark-mcp",
        "mcp",
        "-a", "<your_app_id>",
        "-s", "<your_app_secret>",
        "-t", "im.v1.message.create,im.v1.message.list,im.v1.chat.create,preset.calendar.default"
      ]
    }
  }
}
```

关于所有预设工具集的详细信息以及每个预设包含哪些工具，请参考[预设工具集参考文档](./docs/reference/tool-presets/presets-zh.md)。

对于所有支持的飞书/Lark工具列表可以在[tools.md](./docs/reference/tool-presets/tools-zh.md)中查看。

当前 fork 额外补充了几类更适合 Agent 工作流的 builtin 工具：

- `docx.builtin.create`：根据 Markdown 创建新 Docx 文档
- `docx.builtin.fetch`：获取文档元数据和官方 Markdown 内容
- `docx.builtin.update`：支持 overwrite、append、replace、insert、delete 等模式原地更新文档
- `docx.builtin.markdownRead`：将文档内容转换为 Markdown
- `docx.builtin.markdownWrite`：根据 Markdown 新建文档，或在传入 `document_id` 时原地覆盖正文
- `drive.builtin.upload` / `drive.builtin.download`：本地文件与云盘之间的上传下载
- `bitable.builtin.smartQuery`：输入多维表格或 Wiki URL 后自动解析并查询记录

> **⚠️ 提示**：非预设 API 没有经过兼容性测试，AI在理解使用的过程中可能效果不理想

### 在开发Agent中使用

开发者可参考在 Agent 中集成的最小示例：[`lark-samples/mcp_quick_demo`](https://github.com/larksuite/lark-samples/tree/main/mcp_quick_demo)。

另外可参考 Lark 机器人集成示例：[`lark-samples/mcp_larkbot_demo/nodejs`](https://github.com/larksuite/lark-samples/tree/main/mcp_larkbot_demo/nodejs)。

该示例展示如何将 MCP 能力集成到飞书/Lark 机器人中，通过机器人会话触发工具调用与消息收发，适用于将已有工具接入 Bot 的场景。

### 高级配置

更详细的配置选项和部署场景，请参考我们的[配置指南](./docs/usage/configuration/configuration-zh.md)。

关于所有可用命令行参数及其使用方法的详细信息，请参考[命令行参考文档](./docs/reference/cli/cli-zh.md)。

## 常见问题

- [常见问题（FAQ）](./docs/troubleshooting/faq-zh.md)
- [常见问题与使用案例](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/use_cases)

## 相关链接

- [飞书开放平台](https://open.feishu.cn/)
- [开发文档：OpenAPI MCP](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction)
- [Lark国际版开放平台](https://open.larksuite.com/)
- [飞书开放平台API文档](https://open.feishu.cn/document/home/index)
- [Node.js官网](https://nodejs.org/)
- [npm文档](https://docs.npmjs.com/)

## 反馈

欢迎提交Issues来帮助改进这个工具。如有问题或建议，请在GitHub仓库中提出。
