import { ContainerModule } from '@theia/core/shared/inversify';
import { app } from 'electron';
import { existsSync } from 'fs';
import { resolve } from 'path';

/** Register bundled declarative extensions before the backend is forked. */
export default new ContainerModule(() => {
    const appRoot = app.getAppPath();
    const plugins = [resolve(appRoot, 'plugins'), resolve(appRoot, '..', 'plugins')]
        .find(directory => existsSync(resolve(directory, 'strigoi.astra-theme', 'package.json')));
    if (plugins) {
        const entry = `local-dir:${plugins}`;
        const defaults = process.env.THEIA_DEFAULT_PLUGINS?.split(',').filter(Boolean) ?? [];
        if (!defaults.includes(entry)) { defaults.push(entry); }
        process.env.THEIA_DEFAULT_PLUGINS = defaults.join(',');
    }
});
