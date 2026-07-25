import type { MappingResult } from '../mapper/index.js';
import { getRegistry } from '../registry/index.js';

export interface GeneratedCode {
  code: string;
  imports: string[];
  language: 'tsx' | 'jsx';
  componentCount: number;
  unmappedCount: number;
}

export function generateMwsCode(
  mapping: MappingResult[],
  options?: {
    typescript?: boolean;
    includeImports?: boolean;
    compact?: boolean;
  }
): GeneratedCode {
  const { typescript = true, includeImports = true, compact = false } = options || {};
  const components = new Set<string>();
  const indent = compact ? '' : '  ';

  function generateElement(result: MappingResult, depth: number = 0): string {
    const pad = indent.repeat(depth);
    const childPad = indent.repeat(depth + 1);

    if (result.unmapped) {
      // Fallback: render original tag with class name
      const orig = result.original;
      const attrs = Object.entries(orig.attributes)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');

      if (orig.children.length === 0 && result.original.text) {
        return `${pad}<${orig.tagName}${attrs ? ' ' + attrs : ''}>${result.original.text}</${orig.tagName}>`;
      }

      const childContent = result.children
        .map(c => generateElement(c, depth + 1))
        .join('\n');

      if (childContent) {
        return `${pad}<${orig.tagName}${attrs ? ' ' + attrs : ''}>\n${childContent}\n${pad}</${orig.tagName}>`;
      }
      return `${pad}<${orig.tagName}${attrs ? ' ' + attrs : ''} />`;
    }

    components.add(result.targetComponent);
    const compName = result.targetComponent;

    // Build props string
    const propEntries = Object.entries(result.targetProps)
      .filter(([, v]) => v !== undefined && v !== '' && v !== 'undefined');

    // Extract text content from children
    const textChild = result.original.children.find(c => c.tagName === '#text' && c.text?.trim());
    const mappedChildren = result.children.filter(c => c.original.tagName !== '#text');

    const hasChildren = mappedChildren.length > 0 || !!textChild;

    if (compact) {
      const propsStr = propEntries.map(([k, v]) => {
        if (v === 'true' || v === 'false') return `${k}={${v}}`;
        if (v.startsWith('{')) return `${k}={${v.slice(1, -1)}}`;
        if (k.startsWith('on') || v.startsWith('handle') || v.startsWith('on')) return `${k}={${v}}`;
        return `${k}="${v}"`;
      }).join(' ');

      if (!hasChildren) {
        return `${pad}<${compName}${propsStr ? ' ' + propsStr : ''} />`;
      }
      const childText = textChild?.text || mappedChildren.map(c => generateElement(c, depth + 1)).join(' ');
      return `${pad}<${compName}${propsStr ? ' ' + propsStr : ''}>${childText}</${compName}>`;
    }

    // Expanded format
    const propsLines = propEntries.map(([k, v]) => {
      if (v === 'true' || v === 'false') return `${childPad}${k}={${v}}`;
      if (v.startsWith('{')) return `${childPad}${k}={${v.slice(1, -1)}}`;
      // Event handlers and handler-like values → {expression}
      if (k.startsWith('on') || v.startsWith('handle') || v.startsWith('on')) return `${childPad}${k}={${v}}`;
      return `${childPad}${k}="${v}"`;
    });

    // Handle event handler mapping
    const orig = result.original;
    for (const handler of orig.eventHandlers) {
      const mwsEvent = mapEventHandler(handler);
      if (mwsEvent && !propEntries.some(([k]) => k === mwsEvent)) {
        propsLines.push(`${childPad}${mwsEvent}={${handler.slice(2).charAt(0).toLowerCase() + handler.slice(3) || 'handler'}}`);
      }
    }

    if (!hasChildren) {
      if (propsLines.length > 0) {
        return `${pad}<${compName}\n${propsLines.join('\n')}\n${pad}/>`;
      }
      return `${pad}<${compName} />`;
    }

    const childContent = mappedChildren.map(c => generateElement(c, depth + 1)).join('\n');
    const body = textChild?.text || childContent;

    if (propsLines.length > 0) {
      return `${pad}<${compName}\n${propsLines.join('\n')}\n${pad}>${body ? '\n' + childPad + body + '\n' + pad : ''}</${compName}>`;
    }
    return `${pad}<${compName}>${body ? '\n' + childPad + body + '\n' + pad : ''}</${compName}>`;
  }

  const parts = mapping.map(m => generateElement(m));
  const code = parts.join('\n');

  // Generate imports
  const importStmts: string[] = [];
  if (components.size > 0) {
    importStmts.push(`import { ${Array.from(components).sort().join(', ')} } from '@company/mws-common-ui';`);
  }

  const unmappedCount = countUnmapped(mapping);

  const finalCode = includeImports && importStmts.length > 0
    ? importStmts.join('\n') + '\n\n' + code
    : code;

  return {
    code: finalCode,
    imports: importStmts,
    language: typescript ? 'tsx' : 'jsx',
    componentCount: components.size,
    unmappedCount,
  };
}

function mapEventHandler(handler: string): string | null {
  const map: Record<string, string> = {
    onclick: 'onPress',
    onchange: 'onChange',
    onsubmit: 'onPress',
    onfocus: 'onFocus',
    onblur: 'onBlur',
    onkeydown: 'onKeyDown',
    onkeyup: 'onKeyUp',
    OnClick: 'onPress',
    OnChange: 'onChange',
  };
  return map[handler] || null;
}

function countUnmapped(results: MappingResult[]): number {
  let count = 0;
  for (const r of results) {
    if (r.unmapped) count++;
    count += countUnmapped(r.children);
  }
  return count;
}

// ── Direct Code Generation (no analysis needed) ────────────────

export interface DirectGenerateOptions {
  /** MWS component name, e.g. "MWSButton" */
  component: string;
  /** Component props as key-value pairs */
  props?: Record<string, string>;
  /** Child text content */
  children?: string;
  /** Nested child component names for composition */
  childComponents?: DirectGenerateOptions[];
  /** Generate TypeScript (tsx) or JavaScript (jsx). Default: tsx */
  typescript?: boolean;
  /** Include imports. Default: true */
  includeImports?: boolean;
  /** Compact single-line format. Default: false */
  compact?: boolean;
}

export function generateDirectCode(options: DirectGenerateOptions): GeneratedCode {
  const {
    component: compName,
    props = {},
    children,
    childComponents = [],
    typescript = true,
    includeImports = true,
    compact = false,
  } = options;

  const registry = getRegistry();
  const comp = registry.getComponent(compName) || registry.searchComponents(compName)[0];

  const indent = compact ? '' : '  ';

  // Build props lines
  const propEntries = Object.entries(props).filter(([, v]) => v !== undefined && v !== '');
  const propsLines = propEntries.map(([k, v]) => {
    // Event handlers (onXxx) and handler-like values → {expression}
    if (k.startsWith('on') || v.startsWith('handle') || v.startsWith('on')) {
      return `${compact ? '' : indent}${k}={${v}}`;
    }
    // Boolean literals
    if (v === 'true' || v === 'false') {
      return `${compact ? '' : indent}${k}={${v}}`;
    }
    // Plain string values → quoted
    return `${compact ? '' : indent}${k}="${v}"`;
  });

  // Generate child components recursively
  const childElements = childComponents.map(child =>
    generateDirectCode({ ...child, typescript, includeImports: false, compact })
  );
  const childCode = childElements.map(c => c.code).join('\n');
  const hasChildCode = childCode.length > 0;
  const hasChildren = !!children || hasChildCode;

  // Generate the component JSX
  let code: string;

  if (compact) {
    const propsStr = propsLines.join(' ');
    if (!hasChildren) {
      code = `<${compName}${propsStr ? ' ' + propsStr : ''} />`;
    } else {
      const body = children || childCode;
      code = `<${compName}${propsStr ? ' ' + propsStr : ''}>${body}</${compName}>`;
    }
  } else {
    if (!hasChildren) {
      if (propsLines.length > 0) {
        code = `<${compName}\n${propsLines.join('\n')}\n/>`;
      } else {
        code = `<${compName} />`;
      }
    } else {
      const body = children
        ? (children.includes('\n') ? `\n${indent}${indent}${children}\n${indent}` : children)
        : `\n${indent}${childCode.replace(/\n/g, '\n' + indent)}\n`;
      if (propsLines.length > 0) {
        code = `<${compName}\n${propsLines.join('\n')}\n>${typeof body === 'string' ? body : ''}</${compName}>`;
      } else {
        code = `<${compName}>${typeof body === 'string' ? body : ''}</${compName}>`;
      }
    }
  }

  // Collect all unique component names for imports
  const allComponents = new Set<string>();
  allComponents.add(compName);
  function collectComponents(opts: DirectGenerateOptions) {
    allComponents.add(opts.component);
    for (const c of opts.childComponents || []) collectComponents(c);
  }
  for (const c of childComponents) collectComponents(c);

  // Validate against registry
  const validComponents = [...allComponents].filter(name => {
    const found = registry.getComponent(name) || registry.searchComponents(name)[0];
    return !!found;
  });
  const missing = [...allComponents].filter(name => !validComponents.includes(name));

  const importStmts: string[] = [];
  if (validComponents.length > 0) {
    importStmts.push(`import { ${validComponents.sort().join(', ')} } from '@company/mws-common-ui';`);
  }

  const finalCode = includeImports && importStmts.length > 0
    ? importStmts.join('\n') + '\n\n' + code
    : code;

  return {
    code: finalCode,
    imports: importStmts,
    language: typescript ? 'tsx' : 'jsx',
    componentCount: allComponents.size,
    unmappedCount: 0,
  };
}
