import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MWSProperty {
  name: string;
  type: string;
  description: string;
  defaultValue?: string;
  required: boolean;
  acceptedValues?: (string | number)[];
  isDeprecated?: boolean;
  inlineType?: { name: string; type: string; values?: string[] };
}

export interface MWSEvent {
  name: string;
  description: string;
  cancelable: boolean;
}

export interface MWSComponent {
  id: string;
  name: string;
  category: string;
  description: string;
  importPath: string;
  version: string;
  isExperimental: boolean;
  properties: Record<string, MWSProperty>;
  events: MWSEvent[];
  tags: string[];
}

export interface MWSCategory {
  id: string;
  name: string;
  description: string;
  components: string[];
}

interface RawApiJson {
  name: string;
  dashCaseName: string;
  category?: string;
  description?: string;
  importPath: string;
  version: string;
  releaseStatus: string;
  properties: Array<{
    name: string;
    type: string;
    inlineType?: { name: string; type: string; values?: string[] };
    optional?: boolean;
    description: string;
    defaultValue?: string;
    deprecatedTag?: string;
  }>;
  events: Array<{
    name: string;
    description: string;
    cancelable: boolean;
  }>;
}

const componentCache: Record<string, MWSComponent> = {};
const categoryCache: Record<string, MWSCategory> = {};

function loadAllComponents(): void {
  // Try dist/registry/data first (production), then src/registry/data (development)
  let dataDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    // Try relative to src/
    const srcDir = path.resolve(__dirname, '../../src/registry/data');
    if (fs.existsSync(srcDir)) {
      dataDir = srcDir;
    } else {
      return;
    }
  }

  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8')) as RawApiJson;
    const componentId = raw.dashCaseName || raw.name;

    const props: Record<string, MWSProperty> = {};
    for (const p of raw.properties || []) {
      const acceptedValues: (string | number)[] = [];
      if (p.inlineType?.type === 'union' && p.inlineType.values) {
        for (const v of p.inlineType.values) {
          if (typeof v === 'string' || typeof v === 'number') acceptedValues.push(v);
        }
      }
      props[p.name] = {
        name: p.name,
        type: p.inlineType?.name || p.type,
        description: p.description,
        defaultValue: p.defaultValue ? p.defaultValue.replace(/^['"]|['"]$/g, '') : undefined,
        required: !p.optional,
        acceptedValues,
        isDeprecated: !!p.deprecatedTag,
        inlineType: p.inlineType,
      };
    }

    const meta: MWSComponent = {
      id: componentId,
      name: raw.name,
      category: raw.category || 'other',
      description: raw.description || '',
      importPath: raw.importPath,
      version: raw.version,
      isExperimental: raw.releaseStatus === 'experimental',
      properties: props,
      events: raw.events || [],
      tags: [raw.name, componentId, raw.category || 'other', raw.releaseStatus].filter(Boolean),
    };

    // Index by both dashCaseName AND component name
    componentCache[componentId] = meta;
    if (raw.name !== componentId) {
      componentCache[raw.name] = meta;
    }
  }

  // Build categories
  for (const comp of Object.values(componentCache)) {
    const catId = comp.category;
    if (!categoryCache[catId]) {
      categoryCache[catId] = {
        id: catId,
        name: catId.charAt(0).toUpperCase() + catId.slice(1),
        description: `${comp.category} components`,
        components: [],
      };
    }
    categoryCache[catId].components.push(comp.id);
  }
}

function ensureLoaded(): void {
  if (Object.keys(componentCache).length === 0) loadAllComponents();
}

export function getRegistry() {
  ensureLoaded();
  return {
    getAllComponents(): Record<string, MWSComponent> {
      ensureLoaded();
      return { ...componentCache };
    },

    getComponent(componentId: string): MWSComponent | undefined {
      ensureLoaded();
      return componentCache[componentId];
    },

    getAllCategories(): Record<string, MWSCategory> {
      ensureLoaded();
      return { ...categoryCache };
    },

    getCategory(categoryId: string): MWSCategory | undefined {
      ensureLoaded();
      return categoryCache[categoryId];
    },

    searchComponents(query: string): MWSComponent[] {
      ensureLoaded();
      const q = query.toLowerCase();
      const seen = new Set<string>();
      return Object.values(componentCache).filter(c => {
        if (seen.has(c.name)) return false;
        const match = c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.tags.some(t => t.toLowerCase().includes(q)) ||
          c.category.toLowerCase().includes(q);
        if (match) seen.add(c.name);
        return match;
      });
    },
  };
}
