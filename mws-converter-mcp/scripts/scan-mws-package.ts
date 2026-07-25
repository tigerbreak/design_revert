/**
 * 扫描 MWS-common-ui 组件的类型定义，自动生成 registry data JSON
 *
 * 用法: npx tsx scripts/scan-mws-package.ts <包路径>
 * 默认: node_modules/@company/mws-common-ui
 */

import * as path from 'path';
import * as fs from 'fs';

const PKG_PATH = process.argv[2] || path.resolve(__dirname, '../node_modules/@company/mws-common-ui');
const OUTPUT_DIR = path.resolve(__dirname, '../src/registry/data');

async function main() {
  const pkgJsonPath = path.join(PKG_PATH, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    console.error(`❌ 找不到包: ${PKG_PATH}`);
    console.log('   用法: npx tsx scripts/scan-mws-package.ts ./path/to/mws-common-ui');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  const typesEntry = pkg.types || pkg.typings || 'dist/index.d.ts';
  const dtsPath = path.resolve(PKG_PATH, typesEntry);

  if (!fs.existsSync(dtsPath)) {
    console.error(`❌ 找不到类型文件: ${dtsPath}`);
    process.exit(1);
  }

  console.log(`📁 扫描类型文件: ${dtsPath}`);
  await scanFromDts(dtsPath);
}

/**
 * 用 react-docgen-typescript 扫描 .d.ts
 */
async function scanFromDts(dtsPath: string) {
  let docgen: any;
  try {
    docgen = await import('react-docgen-typescript');
  } catch {
    console.log('📦 正在安装 react-docgen-typescript...');
    const { execSync } = await import('child_process');
    execSync('npm install --save-dev react-docgen-typescript', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    });
    docgen = await import('react-docgen-typescript');
  }

  const parser = docgen.withCustomConfig(
    path.resolve(__dirname, '../tsconfig.json'),
    {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
    }
  );

  const docs = parser.parse(dtsPath);
  console.log(`🔍 找到 ${docs.length} 个组件`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let count = 0;

  for (const doc of docs) {
    const componentName = doc.displayName || doc.exportedName;
    if (!componentName || componentName === 'unknown') continue;

    const registryEntry: any = {
      name: componentName,
      dashCaseName: toDashCase(componentName),
      category: guessCategory(componentName),
      description: doc.description || `${componentName} 组件`,
      importPath: '@company/mws-common-ui',
      releaseStatus: 'stable',
      properties: [],
      events: [],
    };

    for (const [propName, prop] of Object.entries(doc.props || {})) {
      const p = prop as any;
      if (propName === 'children' || propName === 'key' || propName === 'ref') continue;

      const propEntry: any = {
        name: propName,
        type: mapDocgenType(p.type?.name),
        description: p.description || '',
        defaultValue: p.defaultValue?.value,
        required: p.required || false,
      };

      // 提取 acceptedValues (union 类型)
      if (p.type?.raw && p.type.raw.includes('|')) {
        propEntry.acceptedValues = p.type.raw
          .split('|')
          .map((s: string) => s.trim())
          .filter((s: string) => s !== 'undefined' && s !== 'null');
      } else if (Array.isArray(p.type?.value)) {
        propEntry.acceptedValues = p.type.value.map((v: any) => v.value);
      }

      if (propName.startsWith('on')) {
        registryEntry.events.push(propName);
      }

      registryEntry.properties.push(propEntry);
    }

    const filePath = path.join(OUTPUT_DIR, `${componentName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(registryEntry, null, 2), 'utf-8');
    console.log(`  ✅ ${componentName} (${registryEntry.properties.length} props)`);
    count++;
  }

  console.log(`\n🎉 完成! 已生成 ${count} 个组件 JSON 到 ${OUTPUT_DIR}`);
}

function toDashCase(name: string): string {
  return name
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');
}

function guessCategory(name: string): string {
  if (name.startsWith('MWS')) name = name.slice(3);
  const map: Record<string, string> = {
    Button: 'actions', Icon: 'actions',
    Input: 'forms', Select: 'forms', Checkbox: 'forms', Radio: 'forms',
    Switch: 'forms', Form: 'forms', TextArea: 'forms',
    Table: 'data-display', Card: 'data-display', List: 'data-display',
    Modal: 'overlay', Drawer: 'overlay', Popover: 'overlay', Tooltip: 'overlay',
    Nav: 'navigation', Menu: 'navigation', Tabs: 'navigation', Breadcrumb: 'navigation',
    Layout: 'layout', Grid: 'layout', Container: 'layout',
  };
  for (const [key, category] of Object.entries(map)) {
    if (name.endsWith(key)) return category;
  }
  return 'other';
}

function mapDocgenType(typeName: string): string {
  const map: Record<string, string> = {
    string: 'string', number: 'number', boolean: 'boolean',
    func: 'function', Function: 'function',
    'React.ReactNode': 'node', ReactNode: 'node',
    'React.ElementType': 'element-type',
    'Record<string, any>': 'object', object: 'object',
  };
  return map[typeName] || typeName;
}

main().catch(console.error);
