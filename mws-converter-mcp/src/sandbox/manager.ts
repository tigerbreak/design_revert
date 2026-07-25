import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import os from 'os';

const sandboxTemplateDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../sandbox-template'
);

interface SandboxInstance {
  id: string;
  dir: string;
  process: ChildProcess | null;
  url: string;
  port: number;
  createdAt: Date;
}

const sandboxes = new Map<string, SandboxInstance>();
let portCounter = 5173;

export function getSandboxManager() {
  return {
    async createSandbox(name: string): Promise<{
      sandboxId: string;
      dir: string;
      message: string;
    }> {
      const sandboxId = `sandbox-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const sandboxDir = path.join(os.tmpdir(), 'mws-sandbox', sandboxId);

      // Create sandbox directory
      fs.mkdirSync(sandboxDir, { recursive: true });

      // Copy template files
      if (fs.existsSync(sandboxTemplateDir)) {
        copyDirSync(sandboxTemplateDir, sandboxDir);
      } else {
        // Create minimal template on the fly
        fs.writeFileSync(path.join(sandboxDir, 'package.json'), JSON.stringify({
          name: `sandbox-${name || 'preview'}`,
          private: true,
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
          dependencies: {
            react: '^18.2.0',
            'react-dom': '^18.2.0',
            '@company/mws-common-ui': 'latest',
          },
          devDependencies: {
            '@vitejs/plugin-react': '^4.0.0',
            typescript: '^5.0.0',
            vite: '^5.0.0',
          },
        }, null, 2));

        fs.writeFileSync(path.join(sandboxDir, 'vite.config.ts'), `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: ${portCounter} },
});
`);

        fs.writeFileSync(path.join(sandboxDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MWS Preview - ${name || 'Sandbox'}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`);

        const srcDir = path.join(sandboxDir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });

        // Create a simple main.tsx
        fs.writeFileSync(
          path.join(srcDir, 'main.tsx'),
          `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`
        );

        // Create placeholder App.tsx
        fs.writeFileSync(
          path.join(srcDir, 'App.tsx'),
          `import React from 'react';

export default function App() {
  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h2>MWS Component Preview</h2>
      <p>Use render_in_sandbox to load component preview here.</p>
    </div>
  );
}
`
        );

        // tsconfig.json for sandbox
        fs.writeFileSync(path.join(sandboxDir, 'tsconfig.json'), JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            useDefineForClassFields: true,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            skipLibCheck: true,
            moduleResolution: 'bundler',
            allowImportingTsExtensions: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: 'react-jsx',
            strict: true,
          },
          include: ['src'],
        }, null, 2));
      }

      const sandbox: SandboxInstance = {
        id: sandboxId,
        dir: sandboxDir,
        process: null,
        url: `http://localhost:${portCounter}`,
        port: portCounter,
        createdAt: new Date(),
      };

      portCounter++;
      sandboxes.set(sandboxId, sandbox);

      return {
        sandboxId,
        dir: sandboxDir,
        message: `Sandbox created at ${sandboxDir}. Run start_sandbox to start the dev server.`,
      };
    },

    async renderInSandbox(sandboxId: string, code: string): Promise<{
      success: boolean;
      message: string;
    }> {
      const sandbox = sandboxes.get(sandboxId);
      if (!sandbox) {
        throw new Error(`Sandbox ${sandboxId} not found`);
      }

      const appPath = path.join(sandbox.dir, 'src', 'App.tsx');
      let appCode: string;

      // Wrap the code in a proper App component
      if (code.includes('export default') || code.includes('export function App')) {
        appCode = code;
      } else if (code.includes('function App(') || code.includes('const App')) {
        // Add export if not present
        appCode = code.replace(/^(function|const)\s+App/, 'export default $&');
      } else {
        // Wrap the code in a default App component
        appCode = `import React from 'react';

export default function App() {
  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      ${code.replace(/\n/g, '\n      ')}
    </div>
  );
}
`;
      }

      fs.writeFileSync(appPath, appCode);

      return {
        success: true,
        message: `Component rendered in sandbox. Start/restart the sandbox server to view changes.`,
      };
    },

    async startSandbox(sandboxId: string): Promise<{
      sandboxId: string;
      url: string;
      message: string;
    }> {
      const sandbox = sandboxes.get(sandboxId);
      if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);
      if (sandbox.process) {
        return { sandboxId, url: sandbox.url, message: `Sandbox already running at ${sandbox.url}` };
      }

      // Run npm install first
      await new Promise<void>((resolve, reject) => {
        const install = spawn('npm', ['install', '--silent'], {
          cwd: sandbox.dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
        });
        install.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`npm install failed with code ${code}`));
        });
        install.on('error', reject);
      });

      return new Promise((resolve, reject) => {
        const proc = spawn('npx', ['vite', '--port', String(sandbox.port)], {
          cwd: sandbox.dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
        });

        sandbox.process = proc;

        let started = false;
        const onData = (data: Buffer) => {
          const output = data.toString();
          if (!started && output.includes('Local:')) {
            started = true;
            resolve({
              sandboxId,
              url: sandbox.url,
              message: `Preview server running at ${sandbox.url}`,
            });
          }
        };

        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);

        proc.on('close', (code) => {
          if (!started) {
            reject(new Error(`Server exited with code ${code}`));
          }
        });

        proc.on('error', reject);

        // Timeout after 30 seconds
        setTimeout(() => {
          if (!started) {
            reject(new Error('Sandbox server startup timed out'));
          }
        }, 30000);
      });
    },

    async stopSandbox(sandboxId: string): Promise<{ message: string }> {
      const sandbox = sandboxes.get(sandboxId);
      if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);

      if (sandbox.process) {
        sandbox.process.kill('SIGTERM');
        sandbox.process = null;
      }

      return { message: `Sandbox ${sandboxId} stopped` };
    },

    getSandboxUrl(sandboxId: string): string {
      const sandbox = sandboxes.get(sandboxId);
      if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);
      return sandbox.url;
    },

    async destroySandbox(sandboxId: string): Promise<{ message: string }> {
      const sandbox = sandboxes.get(sandboxId);
      if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);

      if (sandbox.process) {
        sandbox.process.kill('SIGKILL');
      }

      // Clean up directory
      try {
        fs.rmSync(sandbox.dir, { recursive: true, force: true });
      } catch { /* ignore */ }

      sandboxes.delete(sandboxId);
      return { message: `Sandbox ${sandboxId} destroyed` };
    },

    listSandboxes() {
      return Array.from(sandboxes.values()).map(s => ({
        id: s.id,
        url: s.url,
        running: s.process !== null && s.process.exitCode === null,
        createdAt: s.createdAt.toISOString(),
      }));
    },
  };
}

function copyDirSync(src: string, dest: string) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
