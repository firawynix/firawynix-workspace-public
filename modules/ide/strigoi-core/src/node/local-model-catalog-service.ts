import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { createReadStream, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { injectable } from '@theia/core/shared/inversify';
import { LocalHardwareProfile, LocalModelCatalog, LocalModelCatalogEntry, LocalModelCatalogService } from '../common/local-model-catalog-service';
import catalog = require('./model-catalog.json');

const run = promisify(execFile);

@injectable()
export class LocalModelCatalogServiceImpl implements LocalModelCatalogService {

    protected readonly catalog: LocalModelCatalog = catalog as LocalModelCatalog;

    async getCatalog(): Promise<LocalModelCatalog> {
        return this.catalog;
    }

    async getHardwareProfile(): Promise<LocalHardwareProfile> {
        const profile: LocalHardwareProfile = {
            cpu: os.cpus()[0]?.model?.trim() || 'CPU desconhecida',
            threads: os.cpus().length,
            ramGb: Math.floor(os.totalmem() / 1073741824),
            gpu: 'Não identificada',
            vramGb: 0,
            vramReliable: false,
            defaultModelsDirectory: path.join(os.homedir(), '.strigoi', 'models')
        };
        if (process.platform !== 'win32') {
            return profile;
        }
        const diagnostic = path.join(os.tmpdir(), `firawynix-gpu-${randomUUID()}.txt`);
        try {
            await run(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'dxdiag.exe'),
                ['/whql:off', '/t', diagnostic], { timeout: 70000, windowsHide: true });
            const output = await fs.readFile(diagnostic, 'utf8');
            let current = '';
            const adapters: { name: string; memoryMb: number }[] = [];
            for (const line of output.split(/\r?\n/)) {
                const name = line.match(/Card name:\s*(.+)/i);
                if (name) { current = name[1].trim(); }
                const memory = line.match(/Dedicated Memory:\s*(\d+)\s*MB/i);
                if (memory && current) { adapters.push({ name: current, memoryMb: Number(memory[1]) }); }
            }
            adapters.sort((left, right) => right.memoryMb - left.memoryMb);
            if (adapters[0]) {
                profile.gpu = adapters[0].name;
                profile.vramGb = Math.floor(adapters[0].memoryMb / 1024);
                profile.vramReliable = true;
            } else {
                profile.gpu = output.match(/Card name:\s*(.+)/i)?.[1]?.trim() || profile.gpu;
            }
        } catch { /* CPU e RAM continuam disponíveis se o diagnóstico gráfico falhar. */ }
        finally { await fs.rm(diagnostic, { force: true }).catch(() => undefined); }
        return profile;
    }

    async downloadModel(modelId: string, destinationDirectory: string): Promise<string> {
        const entry = this.catalog.models.find(model => model.id === modelId);
        if (!entry) {
            throw new Error(`Modelo local desconhecido: ${modelId}.`);
        }
        this.validateEntry(entry);
        await fs.mkdir(destinationDirectory, { recursive: true });
        const destination = path.join(destinationDirectory, entry.artifact.file);
        if (await this.matchesChecksum(destination, entry.artifact.sha256)) {
            return destination;
        }
        await this.ensureFreeSpace(destinationDirectory, entry.artifact.sizeBytes);
        // A complete but invalid file must never be treated as a usable model,
        // and Windows cannot rename over it atomically.
        await fs.rm(destination, { force: true });
        const partial = `${destination}.part`;
        const received = await this.fileSize(partial);
        const headers = received > 0 ? { Range: `bytes=${received}-` } : undefined;
        const response = await fetch(this.resolveUrl(entry), { headers, redirect: 'follow' });
        if (!response.ok || !response.body) {
            throw new Error(`Não foi possível baixar ${entry.name}: HTTP ${response.status}.`);
        }
        const append = received > 0 && response.status === 206;
        if (!append && received > 0) {
            await fs.rm(partial, { force: true });
        }

        const hash = createHash('sha256');
        if (append) {
            await this.updateHashFromFile(hash, partial);
        }
        await this.writeResponseAndUpdateHash(response.body, partial, append, hash);
        const actual = hash.digest('hex');
        if (actual !== entry.artifact.sha256) {
            await fs.rm(partial, { force: true });
            throw new Error(`A verificação SHA-256 falhou para ${entry.name}; o download foi descartado.`);
        }
        await fs.rename(partial, destination);
        return destination;
    }

    protected resolveUrl(entry: LocalModelCatalogEntry): string {
        const { repository, revision, file } = entry.artifact;
        return `https://huggingface.co/${repository}/resolve/${revision}/${file.split('/').map(encodeURIComponent).join('/')}`;
    }

    protected validateEntry(entry: LocalModelCatalogEntry): void {
        if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(entry.artifact.repository) ||
            !/^[A-Za-z0-9._-]+$/.test(entry.artifact.revision) ||
            entry.artifact.file.split('/').some(segment => !segment || segment === '.' || segment === '..') ||
            !/^[a-f0-9]{64}$/.test(entry.artifact.sha256) ||
            entry.artifact.sizeBytes <= 0) {
            throw new Error(`O catálogo do modelo ${entry.id} não passou na validação de segurança.`);
        }
    }

    protected async ensureFreeSpace(directory: string, requiredBytes: number): Promise<void> {
        const info = await fs.statfs(directory);
        const availableBytes = Number(info.bavail) * Number(info.bsize);
        // Keep a 1 GiB margin so the installer never consumes the last free space of a machine.
        if (availableBytes < requiredBytes + 1024 ** 3) {
            throw new Error('Não há espaço livre suficiente para baixar este modelo com segurança.');
        }
    }

    protected async updateHashFromFile(hash: ReturnType<typeof createHash>, file: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const stream = createReadStream(file);
            stream.on('data', (chunk: Buffer) => hash.update(chunk));
            stream.once('error', reject);
            stream.once('end', resolve);
        });
    }

    protected async matchesChecksum(file: string, expected: string): Promise<boolean> {
        try {
            const hash = createHash('sha256');
            await this.updateHashFromFile(hash, file);
            return hash.digest('hex') === expected;
        } catch {
            return false;
        }
    }

    protected async writeResponseAndUpdateHash(
        body: ReadableStream<Uint8Array>,
        destination: string,
        append: boolean,
        hash: ReturnType<typeof createHash>
    ): Promise<void> {
        const handle = await fs.open(destination, append ? 'a' : 'w');
        try {
            const reader = body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    return;
                }
                const chunk = Buffer.from(value);
                hash.update(chunk);
                await handle.write(chunk);
            }
        } finally {
            await handle.close();
        }
    }

    protected async fileSize(file: string): Promise<number> {
        try {
            return (await fs.stat(file)).size;
        } catch {
            return 0;
        }
    }
}
