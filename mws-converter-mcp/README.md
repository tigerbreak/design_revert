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

## Adding Real MWS-common-ui Components

When you get access to real MWS-common-ui, just:

1. Create `api.json` files for each component in `src/registry/data/`
2. Update mapping rules in `src/mapper/index.ts`
3. Rebuild — no code changes needed

### api.json Format

```json
{
  "name": "MWSButton",
  "dashCaseName": "m-w-s-button",
  "category": "actions",
  "description": "A versatile button component",
  "importPath": "@company/mws-common-ui",
  "properties": [
    {
      "name": "variant",
      "type": "string",
      "inlineType": {
        "name": "MWSButtonVariant",
        "type": "union",
        "values": ["primary", "secondary", "ghost"]
      },
      "optional": true,
      "description": "Visual style variant",
      "defaultValue": "primary"
    }
  ]
}
```

## License

MIT
