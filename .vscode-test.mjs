import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  launchArgs: [
    '--user-data-dir=/tmp/sails-vscode-data',
    '--extensions-dir=/tmp/sails-vscode-extensions',
  ],
});