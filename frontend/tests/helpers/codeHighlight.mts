import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as limits from '../../src/markdownSecurity.ts';

// Load the real private component and its helpers without rendering the App.
export function loadCodeHighlight(useMemo: Function, hljs: object) {
  const text = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const source = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['CodeHighlight', 'highlightSource', 'escapeHTML']);
  const selected = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ''));
  if (selected.length !== names.size) throw new Error('Code highlight functions missing');
  const code = ts.transpileModule(selected.map(node => node.getText(source)).join('\n'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function('require', 'exports', 'useMemo', 'hljs', ...Object.keys(limits), `${code}\nreturn CodeHighlight;`)(
    createRequire(import.meta.url), {}, useMemo, hljs, ...Object.values(limits),
  );
}
