# 囲みマス MCP

囲みマスをプレイするためのMCPです。

## 設定方法

**VSCode**

`mcp.json` などで下記のように設定

```json:mcp.json
{
  "servers": {
    "kakomimasu-mcp": {
      "url": "https://mcp.kakomimasu.com/mcp",
      "type": "http"
    }
  },
}
```

**Gemini CLI**

`.gemini/settings.json` などで以下のように設定

```json:.gemini/settings.json
{
  "mcpServers": {
    "kakomimasu-mcp": {
      "httpUrl": "https://mcp.kakomimasu.com/mcp"
    }
  }
}
```
