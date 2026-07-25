# MWS Converter MCP

A Model Context Protocol (MCP) server that analyzes HTML/React UI code and **converts** it to **MWS-common-ui** components.

## Architecture

```
mws-converter-mcp/
├── src/
│   ├── index.ts            # MCP server entry + all tool registrations
│   ├── registry/
│   │   ├── index.ts        # MWS component registry (loads api.json)
│   │   └── data/           # Mock MWS component definitions
│   ├── analyzer/
│   │   └── index.ts        # HTML/JSX code analysis (babel + cheerio)
│   ├── mapper/
│   │   └── index.ts        # Generic → MWS component mapping rules
│   ├── generator/
│   │   └── index.ts        # MWS-common-ui JSX/TSX code generation
│   ├── converter/
│   │   └── index.ts        # Conversion orchestration (diff + apply)
│   └── sandbox/
│       └── manager.ts      # Vite sandbox lifecycle management
└── sandbox-template/       # Optional sandbox template for previews
```

## Available Tools

### Knowledge (query MWS-common-ui components)
| Tool | Description |
|------|-------------|
| `search_mws_components` | Search MWS components by name, category, or description |
| `get_mws_component_props` | Get detailed component properties, types, and accepted values |
| `get_mws_component_examples` | Get usage examples for a component |

### Conversion (analyze → map → generate)
| Tool | Description |
|------|-------------|
| `analyze_ui_code` | Parse HTML/JSX and identify UI patterns (buttons, inputs, tables, etc.) |
| `convert_to_mws` | Full pipeline: analyze → map to MWS → generate converted code |
| `show_conversion_diff` | Show original vs converted code with confidence summary |
| `apply_conversion` | Write converted code to target file (creates .backup) |
| `batch_convert_directory` | Batch convert all matching files in a directory |

### Sandbox Preview (Vite + React sandbox)
| Tool | Description |
|------|-------------|
| `create_sandbox` | Create a Vite + React sandbox with mws-common-ui installed |
| `render_in_sandbox` | Render MWS component code into the sandbox for preview |
| `start_sandbox` | Start the Vite dev server |
| `stop_sandbox` | Stop the sandbox server |
| `get_sandbox_url` | Get the sandbox preview URL |
| `destroy_sandbox` | Clean up sandbox files |

## Usage

### With Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mws-converter": {
      "command": "node",
      "args": ["/path/to/mws-converter-mcp/dist/index.js"]
    }
  }
}
```

### Development

```bash
npm install
npm run build
npm run dev     # tsx watch mode
```

## How Conversion Works

```
User Code (HTML/React) 
    │
    ▼ analyze_ui_code()
    ├── Babel AST parsing (for JSX/TSX)
    └── Cheerio parsing (for HTML)
    │
    ▼ [AnalyzedElement tree]
    │
    ▼ map_to_mws()
    ├── Match rules: tagName + className + attributes
    ├── Map: <button> → MWSButton, <input> → MWSTextInput, etc.
    └── Map: onclick → onPress, className → ... 
    │
    ▼ [MappingResult tree]
    │
    ▼ generate_mws_code()
    ├── Generate imports: import { MWSButton } from '@company/mws-common-ui'
    ├── Generate JSX with mapped props
    └── Generate TypeScript interface (optional)
    │
    ▼ [GeneratedCode]
    │
    ├── render_in_sandbox() → preview in browser
    └── apply_conversion() → write to file + create backup
```

## Mapping Rules

Default mappings are defined in `src/mapper/index.ts`:

| HTML/Generic | MWS Component | Confidence |
|-------------|---------------|------------|
| `<button>` | `MWSButton` | 0.95 |
| `<input type="text">` | `MWSTextInput` | 0.95 |
| `<input type="password">` | `MWSTextInput` | 0.90 |
| `<textarea>` | `MWSTextInput` | 0.80 |
| `<select>` | `MWSSelect` | 0.90 |
| `<table>` | `MWSTable` | 0.85 |
| `<div class="card">` | `MWSCard` | 0.75 |
| `<div class="modal">` | `MWSModal` | 0.70 |
| `<form>` | `MWSForm` | 0.50 |

## Integrating Real MWS-common-ui Components

### 一键扫描（推荐）

项目提供了一个自动扫描脚本，直接从组件的 TypeScript 类型定义生成 JSON：

```bash
# 如果你的 mws-common-ui 在 node_modules 里
npx tsx scripts/scan-mws-package.ts

# 或者指定任意路径
npx tsx scripts/scan-mws-package.ts /path/to/mws-common-ui
```

脚本会自动：
1. 读取包入口的 `.d.ts` 类型定义
2. 识别每个组件的 Props 接口
3. 提取 prop 名称、类型、acceptedValues、默认值
4. 生成 `src/registry/data/*.json`
5. 按组件名自动分类（Button → actions, Input → forms 等）

组件库升级后只需：

```bash
npm install @company/mws-common-ui@latest
npx tsx scripts/scan-mws-package.ts
npm run build
```

### 手动添加（单个组件）

每个组件对应一个 JSON 文件放在 `src/registry/data/` 下：

```json
{
  "name": "MWSButton",
  "dashCaseName": "m-w-s-button",
  "category": "actions",
  "description": "多功能按钮组件",
  "importPath": "@company/mws-common-ui",
  "releaseStatus": "stable",
  "properties": [
    {
      "name": "variant",
      "type": "string",
      "description": "按钮视觉风格",
      "defaultValue": "primary",
      "acceptedValues": ["primary", "secondary", "ghost"],
      "required": false
    }
  ],
  "events": ["onPress", "onLongPress"]
}
```

| 字段 | 说明 | 从哪里拿 |
|------|------|---------|
| `name` | React 组件名 | 组件源码 `export const MWSButton` |
| `properties[].name` | prop 名 | Props 接口的字段名 |
| `properties[].type` | 类型 | 接口里的类型标注 |
| `properties[].acceptedValues` | 可选值列表 | union 类型如 `'primary' \| 'secondary'` |
| `properties[].defaultValue` | 默认值 | 代码里的 `defaultProps` |
| `events` | 事件回调 | 以 `on` 开头的 prop |

## License

MIT
