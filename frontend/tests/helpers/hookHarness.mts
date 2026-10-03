import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// Load the real component/hook with a controllable hook lifecycle and Wails bridge.
export function loadSource(file: string, react?: object, modules: Record<string, unknown> = {}) {
  const cache = new Map<string, any>();
  const load = (path: string): any => {
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    cache.set(path, module.exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const localRequire = (name: string) => {
      if (Object.hasOwn(modules, name)) return modules[name];
      if (name === 'react' && react) return react;
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.')) {
        const base = resolve(dirname(path), name);
        const target = ['', '.ts', '.tsx'].map((suffix) => base + suffix).find(existsSync);
        if (target) return load(target);
      }
      return require(name);
    };
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
  };
  return load(resolve(sourceRoot, file));
}

export function hookHarness() {
  const slots: any[] = [];
  let cursor = 0;
  const updates: any[] = [];
  let effects: { run: () => void | (() => void); deps: any[] }[] = [];
  return {
    updates,
    get effects() { return effects; },
    render<T>(component: () => T): T { cursor = 0; effects = []; return component(); },
    react: {
      useState(initial: any) {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        return [slots[slot], (value: any) => {
          slots[slot] = typeof value === 'function' ? value(slots[slot]) : value;
          updates.push(slots[slot]);
        }];
      },
      useRef(initial: any) {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = { current: initial };
        return slots[slot];
      },
      useMemo(calculate: () => any, deps: any[]) {
        const slot = cursor++;
        const previous = slots[slot];
        if (!previous || previous.deps.length !== deps.length || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
          slots[slot] = { deps, value: calculate() };
        }
        return slots[slot].value;
      },
      useEffect(run: () => void | (() => void), deps: any[]) { effects.push({ run, deps }); },
    },
  };
}

export function globalValue(name: string, value: unknown) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
  return () => { if (prior) Object.defineProperty(globalThis, name, prior); else delete (globalThis as any)[name]; };
}
