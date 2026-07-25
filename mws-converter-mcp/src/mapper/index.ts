import type { AnalyzedElement } from '../analyzer/index.js';
import type { MWSComponent, MWSProperty } from '../registry/index.js';
import { getRegistry } from '../registry/index.js';

export interface MappingRule {
  /** What to match: HTML tag name, React component name, or className pattern */
  matchTag: string | string[];
  /** Optional className pattern (regex string) */
  matchClass?: string;
  /** Optional attribute conditions: e.g. { type: 'text' } for <input type="text"> */
  matchAttrs?: Record<string, string>;
  /** Target MWS component name */
  targetComponent: string;
  /** Map original attrs → MWS component props */
  propMapping?: Record<string, string>;
  /** Static props to always set */
  staticProps?: Record<string, string>;
  /** Confidence weight */
  weight: number;
}

export interface MappingResult {
  original: AnalyzedElement;
  targetComponent: string;
  targetProps: Record<string, string>;
  confidence: number;
  children: MappingResult[];
  unmapped: boolean;
}

// Default mapping rules for HTML → MWS
const defaultRules: MappingRule[] = [
  // Button mappings
  { matchTag: 'button', targetComponent: 'MWSButton', weight: 0.95,
    propMapping: { onclick: 'onPress', disabled: 'disabled', type: 'type' },
    staticProps: { variant: 'primary' } },
  { matchTag: 'a', matchClass: 'btn|button', targetComponent: 'MWSButton', weight: 0.85,
    propMapping: { onclick: 'onPress' } },
  { matchTag: 'input', matchAttrs: { type: 'submit' }, targetComponent: 'MWSButton', weight: 0.9,
    staticProps: { variant: 'primary', type: 'submit' } },

  // Input mappings
  { matchTag: 'input', matchAttrs: { type: 'text' }, targetComponent: 'MWSTextInput', weight: 0.95,
    propMapping: { placeholder: 'placeholder', value: 'value', disabled: 'disabled', readonly: 'readOnly', required: 'required' } },
  { matchTag: 'input', matchAttrs: { type: 'password' }, targetComponent: 'MWSTextInput', weight: 0.9,
    propMapping: { placeholder: 'placeholder', value: 'value' } },
  { matchTag: 'input', matchAttrs: { type: 'email' }, targetComponent: 'MWSTextInput', weight: 0.9,
    propMapping: { placeholder: 'placeholder', value: 'value' } },
  { matchTag: 'input', matchAttrs: { type: 'search' }, targetComponent: 'MWSTextInput', weight: 0.85,
    propMapping: { placeholder: 'placeholder', value: 'value' } },
  { matchTag: 'textarea', targetComponent: 'MWSTextInput', weight: 0.8,
    propMapping: { placeholder: 'placeholder', value: 'value', disabled: 'disabled' } },
  { matchTag: 'input', matchAttrs: { type: 'number' }, targetComponent: 'MWSTextInput', weight: 0.8,
    propMapping: { placeholder: 'placeholder', value: 'value' } },

  // Select mappings
  { matchTag: 'select', targetComponent: 'MWSSelect', weight: 0.9,
    propMapping: { disabled: 'disabled', multiple: 'multiple' } },

  // Table mappings
  { matchTag: 'table', targetComponent: 'MWSTable', weight: 0.85 },

  // Card/Container mappings
  { matchTag: ['div', 'section', 'article'], matchClass: 'card|panel|box|container', targetComponent: 'MWSCard', weight: 0.75 },
  { matchTag: 'div', matchClass: 'modal|dialog|overlay', targetComponent: 'MWSModal', weight: 0.7 },

  // Fallbacks for generic elements
  { matchTag: 'form', targetComponent: 'MWSForm', weight: 0.5 },
  { matchTag: 'nav', targetComponent: 'MWSNavigation', weight: 0.5 },
  { matchTag: 'img', targetComponent: 'MWSImage', weight: 0.5 },
];

// React component to MWS mapping rules
const reactComponentRules: MappingRule[] = [
  { matchTag: 'Button', targetComponent: 'MWSButton', weight: 0.9,
    propMapping: { onClick: 'onPress', disabled: 'disabled', variant: 'variant' } },
  { matchTag: 'Input', targetComponent: 'MWSTextInput', weight: 0.9,
    propMapping: { placeholder: 'placeholder', value: 'value', onChange: 'onChange', disabled: 'disabled' } },
  { matchTag: 'Select', targetComponent: 'MWSSelect', weight: 0.9,
    propMapping: { value: 'value', onChange: 'onChange', disabled: 'disabled' } },
  { matchTag: 'Table', targetComponent: 'MWSTable', weight: 0.85 },
  { matchTag: 'Modal', targetComponent: 'MWSModal', weight: 0.9,
    propMapping: { isOpen: 'visible', onClose: 'onClose', title: 'title' } },
  { matchTag: 'Card', targetComponent: 'MWSCard', weight: 0.9 },
  { matchTag: 'Dialog', targetComponent: 'MWSModal', weight: 0.85,
    propMapping: { open: 'visible', onClose: 'onClose', title: 'title' } },
  { matchTag: 'Dropdown', targetComponent: 'MWSSelect', weight: 0.8 },
];

function matchElement(el: AnalyzedElement): MappingRule | null {
  const rules = el.type === 'react-component' ? reactComponentRules : defaultRules;

  for (const rule of rules) {
    const tags = Array.isArray(rule.matchTag) ? rule.matchTag : [rule.matchTag];
    if (!tags.includes(el.tagName)) continue;

    // Match className pattern — if rule has matchClass, className MUST exist and match
    if (rule.matchClass) {
      if (!el.className) continue;
      const classPattern = new RegExp(rule.matchClass, 'i');
      if (!classPattern.test(el.className)) continue;
    }

    // Match attributes — if rule has matchAttrs, all must match
    if (rule.matchAttrs) {
      let allMatch = true;
      for (const [key, val] of Object.entries(rule.matchAttrs)) {
        if (el.attributes[key]?.toLowerCase() !== val.toLowerCase()) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;
    }

    return rule;
  }
  return null;
}

function buildMwsProps(el: AnalyzedElement, rule: MappingRule): Record<string, string> {
  const props: Record<string, string> = {};

  // Apply static props
  if (rule.staticProps) {
    Object.assign(props, rule.staticProps);
  }

  // Build a combined map of attributes + event handlers
  // Event handlers use attribute values (function references) when available
  const allAttrs: Record<string, string> = { ...el.attributes };
  for (const handler of el.eventHandlers) {
    if (!allAttrs[handler]) {
      allAttrs[handler] = handler;
    }
  }

  // Map original attributes/events to MWS props
  if (rule.propMapping) {
    for (const [origKey, mwsKey] of Object.entries(rule.propMapping)) {
      const value = allAttrs[origKey];
      if (value !== undefined) {
        props[mwsKey] = value;
      }
    }
  }

  return props;
}

export function mapElements(
  elements: AnalyzedElement[],
  rules?: MappingRule[]
): MappingResult[] {
  const allRules = rules || defaultRules;
  const registry = getRegistry();

  function mapSingle(el: AnalyzedElement): MappingResult {
    const rule = matchElement(el);
    const result: MappingResult = {
      original: el,
      targetComponent: '',
      targetProps: {},
      confidence: 0,
      children: [],
      unmapped: true,
    };

    if (rule) {
      const mwsComponent = registry.getComponent(rule.targetComponent);
      if (mwsComponent) {
        result.targetComponent = rule.targetComponent;
        result.targetProps = buildMwsProps(el, rule);
        result.confidence = rule.weight;
        result.unmapped = false;
      } else {
        // Component not in registry
        result.targetComponent = rule.targetComponent;
        result.confidence = rule.weight * 0.5;
        result.unmapped = false;
      }
    }

    // Map children recursively
    for (const child of el.children) {
      if (child.tagName !== '#text') {
        result.children.push(mapSingle(child));
      }
    }

    return result;
  }

  return elements.map(mapSingle);
}

export function getRules() {
  return { defaultRules, reactComponentRules };
}
