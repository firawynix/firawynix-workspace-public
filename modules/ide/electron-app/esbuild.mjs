/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import esbuild from 'esbuild';

// Theia's native plugin assumes this optional addon is installed. Local VS
// Build Tools without Spectre libraries cannot compile it, so leave its
// dynamic import optional at runtime instead of blocking the entire IDE build.
const optionalWindowsCerts = {
    name: 'optional-windows-ca-certs',
    setup(build) {
        build.onResolve({ filter: /^@vscode\/windows-ca-certs$/ }, () => ({
            path: '@vscode/windows-ca-certs', external: true
        }));
    }
};
nodeOptions.plugins.unshift(optionalWindowsCerts);

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptions);
const electronContext = await esbuild.context(electronOptions);

if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
        electronContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
        await electronContext.rebuild();
        await electronContext.dispose();
    } catch {
        process.exit(1);
    }
}
