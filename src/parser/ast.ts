import { parse } from '@babel/parser';
import type { File } from '@babel/types';

export function parseJs(code: string): File {
  return parse(code, {
    sourceType: 'module',
    plugins: [
      // safe defaults for modern JS
      'topLevelAwait',
      'jsx',
      'typescript',
    ],
  });
}
