import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  sourcemap: true,
  dts: true,
  noExternal: [
    '@actions/core',
    '@actions/github',
    'node-fetch',
    'form-data',
    'yaml',
    'slackify-markdown',
  ],
});
