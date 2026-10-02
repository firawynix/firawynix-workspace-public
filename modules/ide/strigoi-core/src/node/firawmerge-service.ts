import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { FirawMergeService } from '../common/firawmerge-service';

@injectable()
export class FirawMergeServiceImpl implements FirawMergeService {
    async findExecutable(): Promise<string | undefined> {
        const executableDirectory = path.dirname(process.execPath);
        const candidates = [
            path.resolve(executableDirectory, '..', 'FirawMerge.exe'),
            path.join(executableDirectory, 'FirawMerge.exe'),
            path.resolve(executableDirectory, '..', '..', '..', 'firawmerge', 'release'),
            path.join(os.homedir(), 'FirawMerge', 'release')
        ];
        for (const candidate of candidates) {
            if (candidate.toLowerCase().endsWith('.exe') && await this.isFile(candidate)) { return candidate; }
            if (!candidate.toLowerCase().endsWith('.exe')) {
                const releases = await fs.readdir(candidate).catch(() => []);
                const matching = releases.filter(name => /^FirawMerge-[\w.-]+-x64\.exe$/i.test(name)).sort();
                const latest = matching[matching.length - 1];
                if (latest && await this.isFile(path.join(candidate, latest))) { return path.join(candidate, latest); }
            }
        }
        return undefined;
    }

    async launch(executable: string, localPaths: string[]): Promise<void> {
        if (process.platform !== 'win32') { throw new Error('FirawMerge integrado está disponível no Windows.'); }
        if (!path.isAbsolute(executable) || !/^FirawMerge(?:-[\w.-]+-x64)?\.exe$/i.test(path.basename(executable)) || !await this.isFile(executable)) {
            throw new Error('Selecione um executável FirawMerge válido.');
        }
        if (localPaths.length > 3) { throw new Error('Selecione no máximo três entradas locais.'); }
        for (const file of localPaths) {
            if (!path.isAbsolute(file) || !await fs.stat(file).then(stat => stat.isFile() || stat.isDirectory()).catch(() => false)) {
                throw new Error(`Arquivo ou pasta local inválida: ${file}`);
            }
        }
        await new Promise<void>((resolve, reject) => {
            const child = spawn(executable, localPaths, { detached: true, stdio: 'ignore', windowsHide: false });
            child.once('error', reject);
            child.once('spawn', () => { child.unref(); resolve(); });
        });
    }

    protected async isFile(file: string): Promise<boolean> {
        return fs.stat(file).then(stat => stat.isFile()).catch(() => false);
    }
}
