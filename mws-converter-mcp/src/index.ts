#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getRegistry } from './registry/index.js';
import { analyzeCode } from './analyzer/index.js';
import { mapElements } from './mapper/index.js';
import { generateMwsCode, generateDirectCode } from './generator/index.js';
import { getSandboxManager } from './sandbox/manager.js';
import { getConverter } from './converter/index.js';

// ── Schema Definitions ──────────────────────────────────────────

const SearchMwsComponentsSchema = z.object({
  query: z.string().describe('Search query for component name, category, or description'),
});

const GetMwsComponentPropsSchema = z.object({
  component: z.string().describe('MWS component name (e.g. MWSButton)'),
});

const GetMwsComponentExamplesSchema = z.object({
  component: z.string().describe('MWS component name'),
});

const GenerateMwsComponentSchema = z.object({
  component: z.string().describe('MWS component name (e.g. MWSButton)'),
  props: z.record(z.string(), z.string()).optional().describe('Component props as key-value pairs'),
  children: z.string().optional().describe('Child text content'),
  childComponents: z.array(z.object({
    component: z.string().describe('Nested child component name'),
    props: z.record(z.string(), z.string()).optional().describe('Child component props'),
    children: z.string().optional().describe('Child text content'),
  })).optional().describe('Nested child components for composition'),
  compact: z.boolean().optional().describe('Compact single-line format'),
});

const AnalyzeUiCodeSchema = z.object({
  code: z.string().describe('The HTML or React/JSX source code to analyze'),
  sourceType: z.enum(['html', 'jsx', 'tsx']).optional().describe('Source code type (auto-detected if omitted)'),
});

const ConvertToMwsSchema = z.object({
  code: z.string().describe('The HTML or React/JSX source code to convert'),
  sourceType: z.enum(['html', 'jsx', 'tsx']).optional(),
  targetPath: z.string().optional().describe('Optional file path to write the conversion'),
});

const ShowConversionDiffSchema = z.object({
  sessionId: z.string().describe('Conversion session ID from convert_to_mws'),
});

const ApplyConversionSchema = z.object({
  sessionId: z.string().describe('Conversion session ID'),
  targetPath: z.string().optional().describe('Target file path to write (overrides session targetPath)'),
});

const BatchConvertDirectorySchema = z.object({
  directory: z.string().describe('Directory to scan for files'),
  pattern: z.string().optional().describe('File pattern, default: *.{tsx,jsx,html}'),
  recursive: z.boolean().optional().describe('Scan recursively, default: true'),
});

const CreateSandboxSchema = z.object({
  name: z.string().describe('A name for this sandbox preview'),
});

const RenderInSandboxSchema = z.object({
  sandboxId: z.string().describe('Sandbox ID from create_sandbox'),
  code: z.string().describe('The MWS component code to render in the preview'),
});

const StartSandboxSchema = z.object({
  sandboxId: z.string().describe('Sandbox ID'),
});

const StopSandboxSchema = z.object({
  sandboxId: z.string().describe('Sandbox ID'),
});

const DestroySandboxSchema = z.object({
  sandboxId: z.string().describe('Sandbox ID'),
});

// ── Server Setup ─────────────────────────────────────────────────

const server = new Server(
  { name: 'mws-converter-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ── List Tools ───────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Knowledge ──
    {
      name: 'search_mws_components',
      description: 'Search MWS-common-ui components by name, category, or description to find the right component for conversion',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_mws_component_props',
      description: 'Get detailed properties, types, and accepted values for a specific MWS-common-ui component',
      inputSchema: {
        type: 'object',
        properties: {
          component: { type: 'string', description: 'MWS component name (e.g. MWSButton)' },
        },
        required: ['component'],
      },
    },
    {
      name: 'get_mws_component_examples',
      description: 'Get usage examples for a specific MWS-common-ui component',
      inputSchema: {
        type: 'object',
        properties: {
          component: { type: 'string', description: 'MWS component name' },
        },
        required: ['component'],
      },
    },

    // ── Conversion ──
    {
      name: 'analyze_ui_code',
      description: 'Analyze HTML or React/JSX source code to identify UI components, their structure, and patterns',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The HTML or React/JSX source code to analyze' },
          sourceType: { type: 'string', enum: ['html', 'jsx', 'tsx'], description: 'Source code type (auto-detected if omitted)' },
        },
        required: ['code'],
      },
    },
    {
      name: 'convert_to_mws',
      description: 'Analyze source code and convert it to MWS-common-ui components. Returns a conversion session ID for preview and apply.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The HTML or React/JSX source code to convert' },
          sourceType: { type: 'string', enum: ['html', 'jsx', 'tsx'] },
          targetPath: { type: 'string', description: 'Optional file path to write the conversion' },
        },
        required: ['code'],
      },
    },
    {
      name: 'show_conversion_diff',
      description: 'Show a diff summary between original code and converted MWS-common-ui code for a conversion session',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Conversion session ID' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'apply_conversion',
      description: 'Apply the confirmed MWS-common-ui conversion to the target file. Creates a .backup file automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Conversion session ID' },
          targetPath: { type: 'string', description: 'Target file path' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'batch_convert_directory',
      description: 'Batch convert all matching files in a directory from HTML/React to MWS-common-ui',
      inputSchema: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Directory path' },
          pattern: { type: 'string', description: 'File pattern, default: *.{tsx,jsx,html}' },
          recursive: { type: 'boolean', description: 'Scan recursively, default: true' },
        },
        required: ['directory'],
      },
    },
    {
      name: 'generate_mws_component',
      description: 'Directly generate MWS-common-ui component code by name and props, no source analysis needed. Use this when you know which MWS component you want to use — just specify component name, props, children, and nested child components.',
      inputSchema: {
        type: 'object',
        properties: {
          component: { type: 'string', description: 'MWS component name (e.g. MWSButton)' },
          props: { type: 'object', description: 'Component props as key-value pairs', additionalProperties: { type: 'string' } },
          children: { type: 'string', description: 'Child text content' },
          childComponents: { type: 'array', items: { type: 'object', properties: { component: { type: 'string' }, props: { type: 'object' }, children: { type: 'string' } } }, description: 'Nested child components for composition' },
          compact: { type: 'boolean', description: 'Compact single-line format' },
        },
        required: ['component'],
      },
    },

    // ── Sandbox Preview ──
    {
      name: 'create_sandbox',
      description: 'Create a Vite + React sandbox project for previewing MWS-common-ui components',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A name for this sandbox preview' },
        },
        required: ['name'],
      },
    },
    {
      name: 'render_in_sandbox',
      description: 'Render MWS component code into an existing sandbox for visual preview',
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
          code: { type: 'string', description: 'The MWS component code to render' },
        },
        required: ['sandboxId', 'code'],
      },
    },
    {
      name: 'start_sandbox',
      description: 'Start the Vite development server for a sandbox to preview components in browser',
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
        },
        required: ['sandboxId'],
      },
    },
    {
      name: 'stop_sandbox',
      description: 'Stop the sandbox development server',
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
        },
        required: ['sandboxId'],
      },
    },
    {
      name: 'get_sandbox_url',
      description: 'Get the URL of a running sandbox preview server',
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
        },
        required: ['sandboxId'],
      },
    },
    {
      name: 'destroy_sandbox',
      description: 'Destroy a sandbox and clean up its files',
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
        },
        required: ['sandboxId'],
      },
    },
  ],
}));

// ── Call Tool ────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── Registry Tools ──
      case 'search_mws_components': {
        const { query } = SearchMwsComponentsSchema.parse(args);
        const registry = getRegistry();
        const results = registry.searchComponents(query);
        const categories = registry.getAllCategories();
        return createTextResponse(JSON.stringify({
          components: results.map(c => ({
            name: c.name,
            category: c.category,
            description: c.description,
            importPath: c.importPath,
            version: c.version,
            propCount: Object.keys(c.properties).length,
            eventCount: c.events.length,
            isExperimental: c.isExperimental,
          })),
          categories: Object.keys(categories),
          total: results.length,
        }, null, 2));
      }

      case 'get_mws_component_props': {
        const { component } = GetMwsComponentPropsSchema.parse(args);
        const registry = getRegistry();
        let comp = registry.getComponent(component);
        if (!comp) {
          const results = registry.searchComponents(component);
          comp = results.find(c => c.name === component) || results[0];
        }
        if (!comp) throw new Error(`Component '${component}' not found. Available: ${Object.values(registry.getAllComponents()).map(c => c.name).join(', ')}`);

        return createTextResponse(JSON.stringify({
          name: comp.name,
          description: comp.description,
          importPath: comp.importPath,
          properties: Object.values(comp.properties).map(p => ({
            name: p.name,
            type: p.type,
            description: p.description,
            required: p.required,
            defaultValue: p.defaultValue || null,
            acceptedValues: p.acceptedValues?.length ? p.acceptedValues : null,
          })),
          events: comp.events,
        }, null, 2));
      }

      case 'get_mws_component_examples': {
        const { component } = GetMwsComponentExamplesSchema.parse(args);
        const registry = getRegistry();
        const comp = registry.getComponent(component) || registry.searchComponents(component)[0];
        if (!comp) throw new Error(`Component '${component}' not found`);

        const examples = [
          `// Basic usage\n<${comp.name}>${comp.name === 'MWSButton' ? 'Click me' : ''}</${comp.name}>`,
          `// With props\n<${comp.name} ${Object.entries(comp.properties).slice(0, 3).map(([k, p]) => {
            if (p.acceptedValues?.length) return `${k}="${p.acceptedValues[0]}"`;
            if (p.type === 'boolean') return `${k}`;
            if (p.type === 'function') return `${k}={() => {}}`;
            return `${k}="..."`;
          }).join(' ')} />`,
        ];

        return createTextResponse(JSON.stringify({
          component: comp.name,
          importStatement: `import { ${comp.name} } from '${comp.importPath}';`,
          examples,
          propCount: Object.keys(comp.properties).length,
          availableProps: Object.values(comp.properties).map(p => p.name),
        }, null, 2));
      }

      // ── Direct Generate ──
      case 'generate_mws_component': {
        const genArgs = GenerateMwsComponentSchema.parse(args);
        const result = generateDirectCode({
          component: genArgs.component,
          props: (genArgs.props || {}) as Record<string, string>,
          children: genArgs.children,
          childComponents: (genArgs.childComponents || []).map(c => ({
            component: c.component,
            props: (c.props || {}) as Record<string, string>,
            children: c.children,
          })),
          compact: genArgs.compact,
        });

        return createTextResponse(JSON.stringify({
          code: result.code,
          imports: result.imports,
          language: result.language,
          componentCount: result.componentCount,
          sessionId: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        }, null, 2));
      }

      // ── Analysis & Conversion ──
      case 'analyze_ui_code': {
        const { code, sourceType } = AnalyzeUiCodeSchema.parse(args);
        const result = analyzeCode(code, sourceType);
        return createTextResponse(JSON.stringify({
          summary: result.summary,
          sourceType: result.sourceType,
          elements: result.elements.map(el => ({
            tag: el.tagName,
            type: el.type,
            className: el.className || null,
            id: el.id || null,
            attributes: el.attributes,
            eventHandlers: el.eventHandlers,
            childCount: el.children.length,
            isInput: el.isInput,
            isButton: el.isButton,
            isForm: el.isForm,
            isTable: el.isTable,
            isContainer: el.isContainer,
          })),
          imports: result.imports.length > 0 ? result.imports : undefined,
        }, null, 2));
      }

      case 'convert_to_mws': {
        const params = ConvertToMwsSchema.parse(args);
        const converter = getConverter();
        const session = converter.analyzeAndConvert({
          code: params.code,
          sourceType: params.sourceType,
          targetPath: params.targetPath,
        });
        return createTextResponse(JSON.stringify({
          sessionId: session.id,
          originalCode: session.originalCode,
          convertedCode: session.generated.code,
          summary: {
            componentsMapped: session.generated.componentCount,
            componentsUnmapped: session.generated.unmappedCount,
            language: session.generated.language,
            imports: session.generated.imports,
          },
          prompt: 'Use show_conversion_diff to see details, or apply_conversion to write the file.',
        }, null, 2));
      }

      case 'show_conversion_diff': {
        const { sessionId } = ShowConversionDiffSchema.parse(args);
        const converter = getConverter();
        const diff = converter.getConversionDiff(sessionId);
        return createTextResponse(JSON.stringify(diff, null, 2));
      }

      case 'apply_conversion': {
        const { sessionId, targetPath } = ApplyConversionSchema.parse(args);
        const converter = getConverter();
        const result = await converter.applyConversion(sessionId, targetPath);
        return createTextResponse(JSON.stringify(result, null, 2));
      }

      case 'batch_convert_directory': {
        const params = BatchConvertDirectorySchema.parse(args);
        const converter = getConverter();
        const result = await converter.batchConvertDirectory({
          directory: params.directory,
          pattern: params.pattern,
          recursive: params.recursive,
        });
        return createTextResponse(JSON.stringify({
          totalFiles: result.totalFiles,
          convertedFiles: result.convertedFiles,
          sessions: result.sessions.map(s => ({
            sessionId: s.id,
            targetPath: s.targetPath,
            componentsMapped: s.generated.componentCount,
            language: s.generated.language,
          })),
        }, null, 2));
      }

      // ── Sandbox Tools ──
      case 'create_sandbox': {
        const { name } = CreateSandboxSchema.parse(args);
        const sb = getSandboxManager();
        const result = await sb.createSandbox(name);
        return createTextResponse(JSON.stringify(result, null, 2));
      }

      case 'render_in_sandbox': {
        const { sandboxId, code } = RenderInSandboxSchema.parse(args);
        const sb = getSandboxManager();
        const result = await sb.renderInSandbox(sandboxId, code);
        return createTextResponse(JSON.stringify(result, null, 2));
      }

      case 'start_sandbox': {
        const { sandboxId } = StartSandboxSchema.parse(args);
        const sb = getSandboxManager();
        const result = await sb.startSandbox(sandboxId);
        return createTextResponse(JSON.stringify(result, null, 2));
      }

      case 'stop_sandbox': {
        const { sandboxId } = StopSandboxSchema.parse(args);
        const sb = getSandboxManager();
        const result = await sb.stopSandbox(sandboxId);
        return createTextResponse(JSON.stringify(result, null, 2));
      }

      case 'get_sandbox_url': {
        const { sandboxId } = z.object({ sandboxId: z.string() }).parse(args);
        const sb = getSandboxManager();
        const url = sb.getSandboxUrl(sandboxId);
        return createTextResponse(JSON.stringify({ sandboxId, url }, null, 2));
      }

      case 'destroy_sandbox': {
        const { sandboxId } = DestroySandboxSchema.parse(args);
        const sb = getSandboxManager();
        const result = await sb.destroySandbox(sandboxId);
        return createTextResponse(JSON.stringify(result, null, 2));
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    const err = error as any;
    if (err?.issues || err?.name === 'ZodError') {
      const zodIssues: any[] = err.issues || [];
      throw new Error(
        `Invalid arguments: ${zodIssues
          .map((e: any) => `${e.path?.join('.') || ''}: ${e.message}`)
          .join(', ')}`
      );
    }
    throw error;
  }
});

// ── Start Server ────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('MWS Converter MCP Server running on stdio');

function createTextResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
