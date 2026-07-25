import * as babelParser from '@babel/parser';
import traverse from '@babel/traverse';
import * as cheerio from 'cheerio';

export interface AnalyzedElement {
  type: 'html' | 'react-component' | 'native-element';
  tagName: string;
  attributes: Record<string, string>;
  children: AnalyzedElement[];
  text?: string;
  className?: string;
  id?: string;
  eventHandlers: string[];
  isInput: boolean;
  isButton: boolean;
  isForm: boolean;
  isTable: boolean;
  isContainer: boolean;
}

function fullClassify(tag: string) {
  const t = tag.toLowerCase();
  return {
    isInput: ['input', 'select', 'textarea', 'checkbox', 'radio'].includes(t),
    isButton: ['button', 'a'].includes(t) || t === 'a',
    isForm: ['form', 'fieldset'].includes(t),
    isTable: ['table', 'thead', 'tbody', 'tr', 'td', 'th'].includes(t),
    isContainer: ['div', 'section', 'article', 'main', 'aside', 'nav', 'header', 'footer', 'span'].includes(t),
  };
}

export interface AnalysisResult {
  elements: AnalyzedElement[];
  imports: string[];
  sourceType: 'html' | 'jsx' | 'tsx';
  summary: string;
}

function parseHtmlAttributes(element: any): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (element.attribs) {
    for (const [k, v] of Object.entries(element.attribs)) {
      if (k !== 'class' && k !== 'id') {
        attrs[k] = String(v || '');
      }
    }
  }
  return attrs;
}

function parseHtmlEvents(element: any): string[] {
  const events: string[] = [];
  if (element.attribs) {
    for (const key of Object.keys(element.attribs)) {
      if (key.startsWith('on') && key.length > 2) {
        events.push(key);
      }
    }
  }
  return events;
}

function analyzeHtmlNode(element: any): AnalyzedElement {
  const tagName = element.tagName || element.name || 'div';
  const classification = fullClassify(tagName);
  const children: AnalyzedElement[] = [];

  if (element.children) {
    for (const child of element.children) {
      if (child.type === 'tag' || child.type === 'element') {
        children.push(analyzeHtmlNode(child));
      } else if (child.type === 'text' && child.data?.trim()) {
        children.push({
          type: 'native-element',
          tagName: '#text',
          attributes: {},
          children: [],
          text: child.data.trim(),
          eventHandlers: [],
          isInput: false, isButton: false, isForm: false, isTable: false, isContainer: false,
        });
      }
    }
  }

  return {
    type: 'native-element',
    tagName,
    attributes: parseHtmlAttributes(element),
    children,
    className: element.attribs?.class || element.attribs?.className,
    id: element.attribs?.id,
    eventHandlers: parseHtmlEvents(element),
    ...classification,
  };
}

function parseJsxEvents(attrName: string): string | null {
  const eventMap: Record<string, string> = {
    onclick: 'onClick',
    onchange: 'onChange',
    onsubmit: 'onSubmit',
    onfocus: 'onFocus',
    onblur: 'onBlur',
    onkeydown: 'onKeyDown',
    onkeyup: 'onKeyUp',
    onmouseenter: 'onMouseEnter',
    onmouseleave: 'onMouseLeave',
  };
  return eventMap[attrName.toLowerCase()] || null;
}

function analyzeJsxNode(node: any): AnalyzedElement {
  const tagName = node.type === 'JSXElement'
    ? (node.openingElement?.name?.name || (node.openingElement?.name?.object?.name + '.' + node.openingElement?.name?.property?.name) || 'unknown')
    : 'unknown';

  const classification = fullClassify(tagName);
  const children: AnalyzedElement[] = [];
  const attributes: Record<string, string> = {};
  const eventHandlers: string[] = [];

  if (node.openingElement?.attributes) {
    for (const attr of node.openingElement.attributes) {
      if (attr.type === 'JSXAttribute') {
        const attrName = attr.name?.name || '';
        let attrValue = '';
        if (attr.value?.type === 'StringLiteral') attrValue = attr.value.value;
        else if (attr.value?.type === 'JSXExpressionContainer') attrValue = '{...}';

        if (attrName.startsWith('on') && attrName.length > 2) {
          eventHandlers.push(attrName);
        } else if (attrName !== 'className' && attrName !== 'id') {
          attributes[attrName] = attrValue;
        }
      }
    }
  }

  const nodeClassName = node.openingElement?.attributes?.find(
    (a: any) => a.name?.name === 'className' || a.name?.name === 'class'
  );
  const nodeId = node.openingElement?.attributes?.find(
    (a: any) => a.name?.name === 'id'
  );

  if (node.children) {
    for (const child of node.children) {
      if (child.type === 'JSXElement') {
        children.push(analyzeJsxNode(child));
      } else if (child.type === 'JSXText' && child.value?.trim()) {
        children.push({
          type: 'native-element',
          tagName: '#text',
          attributes: {},
          children: [],
          text: child.value.trim(),
          eventHandlers: [],
          isInput: false, isButton: false, isForm: false, isTable: false, isContainer: false,
        });
      } else if (child.type === 'JSXExpressionContainer' && child.expression?.type === 'JSXElement') {
        children.push(analyzeJsxNode(child.expression));
      }
    }
  }

  return {
    type: tagName[0] === tagName[0]?.toUpperCase() ? 'react-component' : 'native-element',
    tagName,
    attributes,
    children,
    className: nodeClassName?.value?.value || nodeClassName?.value?.expression?.value,
    id: nodeId?.value?.value,
    eventHandlers,
    ...classification,
  };
}

export function analyzeCode(code: string, sourceType?: 'html' | 'jsx' | 'tsx'): AnalysisResult {
  const trimmed = code.trim();

  // Detect source type if not specified
  let detectedType = sourceType;
  if (!detectedType) {
    if (trimmed.startsWith('<') && !trimmed.startsWith('</')) {
      if (trimmed.match(/import\s+(React|\{)/) || trimmed.match(/export\s+(default\s+)?(function|const)/)) {
        detectedType = 'tsx';
      } else if (trimmed.match(/<[A-Z]/)) {
        detectedType = 'tsx';
      } else {
        detectedType = 'html';
      }
    } else {
      detectedType = 'tsx';
    }
  }

  let elements: AnalyzedElement[] = [];
  const imports: string[] = [];

  if (detectedType === 'html') {
    const $ = cheerio.load(trimmed);
    // cheerio wraps in <html><head><body> - extract body children for meaningful content
    const body = $('body');
    let rootChildren;
    if (body.length > 0) {
      rootChildren = body.children()?.toArray() || [];
    } else {
      rootChildren = $.root()?.children()?.toArray() || [];
    }
    for (const el of rootChildren) {
      if (el.type === 'tag' || (el as any).type === 'element') {
        elements.push(analyzeHtmlNode(el));
      }
    }
  } else {
    // JSX/TSX parsing
    try {
      // Extract imports
      const importRegex = /import\s+.*?from\s+['"].*?['"];?\s*/g;
      let match;
      while ((match = importRegex.exec(trimmed)) !== null) {
        imports.push(match[0].trim());
      }

      const ast = babelParser.parse(trimmed, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'decorators-legacy'],
      });

      traverse(ast, {
        JSXElement(path: any) {
          if (!path.parentPath.isJSXElement()) {
            elements.push(analyzeJsxNode(path.node));
          }
        },
        JSXFragment(path: any) {
          if (path.parentPath.isJSXFragment() || path.parentPath.isReturnStatement() || path.parentPath.isArrowFunctionExpression()) {
            // Wrap fragment children
            for (const child of path.node.children) {
              if (child.type === 'JSXElement') {
                elements.push(analyzeJsxNode(child));
              }
            }
          }
        },
      });

      // If no JSX found via traverse, try to parse as JSX text directly
      if (elements.length === 0) {
        const directParse = babelParser.parse(trimmed, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript'],
        });
        traverse(directParse, {
          JSXElement(path: any) {
            if (!path.parentPath.isJSXElement()) {
              elements.push(analyzeJsxNode(path.node));
            }
          },
        });
      }
    } catch {
      // Fallback: treat as HTML-like if babel fails
      try {
        const $ = cheerio.load(trimmed);
        const body = $('body');
        const rootChildren = body.length > 0 ? body.children()?.toArray() || [] : $.root()?.children()?.toArray() || [];
        for (const el of rootChildren) {
          if (el.type === 'tag' || (el as any).type === 'element') {
            elements.push(analyzeHtmlNode(el));
          }
        }
        detectedType = 'html';
      } catch {
        elements = [];
      }
    }
  }

  const summary = elements.length > 0
    ? `Found ${elements.length} root element(s): ${elements.map(e => `<${e.tagName}>`).join(', ')}`
    : 'No elements found in the provided code';

  return { elements, imports, sourceType: detectedType, summary };
}
