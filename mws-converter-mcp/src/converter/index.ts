import fs from 'fs';
import path from 'path';
import { analyzeCode, type AnalysisResult } from '../analyzer/index.js';
import { mapElements, type MappingResult } from '../mapper/index.js';
import { generateMwsCode, type GeneratedCode } from '../generator/index.js';

export interface ConversionSession {
  id: string;
  createdAt: string;
  analysis: AnalysisResult;
  mapping: MappingResult[];
  generated: GeneratedCode;
  originalCode: string;
  targetPath?: string;
  confirmed: boolean;
}

const sessions = new Map<string, ConversionSession>();

export function getConverter() {
  return {
    analyzeAndConvert(params: {
      code: string;
      sourceType?: 'html' | 'jsx' | 'tsx';
      targetPath?: string;
    }): ConversionSession {
      const { code, sourceType, targetPath } = params;

      // Step 1: Analyze
      const analysis = analyzeCode(code, sourceType);

      // Step 2: Map
      const mapping = mapElements(analysis.elements);

      // Step 3: Generate
      const generated = generateMwsCode(mapping, {
        typescript: analysis.sourceType === 'tsx',
        includeImports: true,
      });

      const session: ConversionSession = {
        id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        createdAt: new Date().toISOString(),
        analysis,
        mapping,
        generated,
        originalCode: code,
        targetPath,
        confirmed: false,
      };

      sessions.set(session.id, session);
      return session;
    },

    getConversionDiff(sessionId: string): {
      original: string;
      converted: string;
      summary: {
        componentsMapped: number;
        componentsUnmapped: number;
        totalOriginalElements: number;
        confidence: number;
      };
    } {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Conversion session ${sessionId} not found`);

      const totalElements = countElements(session.mapping);
      const mappedResults = flattenResults(session.mapping).filter(m => !m.unmapped);
      const avgConfidence = mappedResults.length > 0
        ? mappedResults.reduce((s, m) => s + m.confidence, 0) / mappedResults.length
        : 0;

      return {
        original: session.originalCode,
        converted: session.generated.code,
        summary: {
          componentsMapped: session.generated.componentCount,
          componentsUnmapped: session.generated.unmappedCount,
          totalOriginalElements: totalElements,
          confidence: Math.round(avgConfidence * 100) / 100,
        },
      };
    },

    async applyConversion(sessionId: string, targetPath?: string): Promise<{
      success: boolean;
      filePath: string;
      message: string;
    }> {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Conversion session ${sessionId} not found`);

      const filePath = targetPath || session.targetPath;
      if (!filePath) {
        throw new Error('No target path specified for applying conversion');
      }

      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create backup
      if (fs.existsSync(filePath)) {
        const backupPath = filePath + '.backup';
        fs.copyFileSync(filePath, backupPath);
      }

      // Write converted code
      fs.writeFileSync(filePath, session.generated.code, 'utf-8');

      session.confirmed = true;
      session.targetPath = filePath;

      return {
        success: true,
        filePath,
        message: `Conversion applied to ${filePath}. Backup saved as ${filePath}.backup`,
      };
    },

    getSession(sessionId: string): ConversionSession | undefined {
      return sessions.get(sessionId);
    },

    listSessions() {
      return Array.from(sessions.values()).map(s => ({
        id: s.id,
        createdAt: s.createdAt,
        componentsCount: s.generated.componentCount,
        confirmed: s.confirmed,
        targetPath: s.targetPath,
      }));
    },

    async batchConvertDirectory(params: {
      directory: string;
      pattern?: string;
      recursive?: boolean;
    }): Promise<{
      sessions: ConversionSession[];
      totalFiles: number;
      convertedFiles: number;
    }> {
      const { directory, pattern = '*.{tsx,jsx,html}', recursive = true } = params;
      const results: ConversionSession[] = [];

      // Find matching files
      const files = findFiles(directory, pattern, recursive);

      for (const file of files) {
        try {
          const content = fs.readFileSync(file, 'utf-8');
          const ext = path.extname(file);
          const sourceType = ext === '.html' ? 'html' : ext === '.tsx' ? 'tsx' : 'jsx';

          const session = this.analyzeAndConvert({
            code: content,
            sourceType: sourceType as any,
            targetPath: file,
          });

          results.push(session);
        } catch {
          // Skip files that can't be parsed
        }
      }

      return {
        sessions: results,
        totalFiles: files.length,
        convertedFiles: results.length,
      };
    },
  };
}

function flattenResults(mapping: MappingResult[]): MappingResult[] {
  const results: MappingResult[] = [];
  for (const m of mapping) {
    results.push(m);
    results.push(...flattenResults(m.children));
  }
  return results;
}

function countElements(mapping: MappingResult[]): number {
  let count = 0;
  for (const m of mapping) {
    count++;
    count += countElements(m.children);
  }
  return count;
}

function findFiles(dir: string, pattern: string, recursive: boolean): string[] {
  const results: string[] = [];
  const regex = new RegExp(
    pattern.replace(/\*/g, '.*').replace(/\{([^}]+)\}/g, (_, group) =>
      group.split(',').map((s: string) => s.trim()).join('|')
    ),
    'i'
  );

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory() && recursive && entry.name !== 'node_modules') {
        walk(fullPath);
      } else if (entry.isFile() && regex.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}
