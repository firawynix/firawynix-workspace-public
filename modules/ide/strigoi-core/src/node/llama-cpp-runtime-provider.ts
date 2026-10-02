import { ChildProcess, execFile, spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { LocalModelDetails, LocalRuntimeConfiguration, LocalRuntimeStatus } from '../common/local-runtime-service';

/** Owns only processes launched by Strigoi; it never stops an external llama.cpp server. */
export class LlamaCppRuntimeProvider {

    protected readonly host = '127.0.0.1';
    protected readonly port = 18789;
    protected process: ChildProcess | undefined;
    protected loadedModelPath: string | undefined;
    protected readonly backendDeviceCache = new Map<string, string | undefined>();

    async getStatus(configuration: LocalRuntimeConfiguration): Promise<LocalRuntimeStatus> {
        const executable = (await this.resolveExecutables(configuration))[0];
        if (!executable) {
            return this.status(configuration, 'runtime-unavailable', {
                message: 'O runtime llama.cpp ainda não está instalado neste Strigoi.'
            });
        }
        const modelPath = await this.resolveModelPath(configuration);
        if (!modelPath) {
            return this.status(configuration, 'missing-model', {
                message: 'O runtime próprio está pronto, mas o arquivo GGUF selecionado não foi encontrado.'
            });
        }
        return this.status(configuration, 'ready', {
            detectedModel: { name: path.basename(modelPath, path.extname(modelPath)), filePath: modelPath },
            availableModelCount: 1,
            isLoaded: this.process !== undefined && this.loadedModelPath === modelPath,
            endpoint: this.endpoint()
        });
    }

    async getModels(configuration: LocalRuntimeConfiguration): Promise<LocalModelDetails[]> {
        const configuredModel = configuration.llamaModelPath && await this.exists(configuration.llamaModelPath)
            ? configuration.llamaModelPath
            : undefined;
        const directory = await this.modelsDirectory(configuration);
        if (!directory || !await this.exists(directory)) {
            return configuredModel ? [this.toModelDetails(configuredModel)] : [];
        }
        const models = (await this.modelPaths(directory)).map(model => this.toModelDetails(model));
        if (configuredModel && !models.some(model => model.filePath === configuredModel)) {
            models.unshift(this.toModelDetails(configuredModel));
        }
        return models;
    }

    async loadModel(configuration: LocalRuntimeConfiguration): Promise<LocalRuntimeStatus> {
        const executables = await this.resolveExecutables(configuration);
        if (executables.length === 0) {
            throw new Error('O runtime llama.cpp não foi encontrado no pacote do Strigoi.');
        }
        const modelPath = await this.resolveModelPath(configuration);
        if (!modelPath) {
            throw new Error('O arquivo GGUF configurado não foi encontrado.');
        }
        if (this.process && this.loadedModelPath === modelPath) {
            return this.getStatus(configuration);
        }
        await this.unloadModel();
        let lastError: Error | undefined;
        for (const executable of executables) {
            const backend = path.basename(path.dirname(executable)).toLowerCase();
            const isVulkan = backend === 'vulkan';
            const isAccelerated = backend === 'rocm' || isVulkan;
            const arguments_ = [
                '--model', modelPath,
                '--host', this.host,
                '--port', String(this.port),
                // Qwen3 supports a much larger model context.  Keep 16k as the
                // local default: enough for a useful research conversation while
                // avoiding the heavy KV-cache and first-token cost of 32k.
                '--ctx-size', '16384',
                '--parallel', '1',
                '--cache-ram', '8192',
                '--flash-attn', 'auto',
                '--n-gpu-layers', isAccelerated ? 'all' : '0'
            ];
            if (isVulkan) {
                const device = await this.resolveBackendDevice(executable, 'Vulkan');
                if (device) {
                    arguments_.push('--device', device);
                }
            } else if (backend === 'rocm') {
                const device = await this.resolveBackendDevice(executable, 'ROCm');
                if (device) {
                    arguments_.push('--device', device);
                }
            }
            this.process = spawn(executable, arguments_, { windowsHide: true, stdio: 'ignore' });
            this.loadedModelPath = modelPath;
            this.process.once('exit', () => {
                this.process = undefined;
                this.loadedModelPath = undefined;
            });
            try {
                await this.waitForHealth();
                return this.getStatus(configuration);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error('Não foi possível iniciar o runtime llama.cpp.');
                console.warn(`[Strigoi] O backend local '${backend}' não iniciou; tentando o próximo backend.`, lastError.message);
                await this.unloadModel();
            }
        }
        throw lastError ?? new Error('Não foi possível iniciar o runtime llama.cpp.');
    }

    async unloadModel(): Promise<void> {
        const running = this.process;
        this.process = undefined;
        this.loadedModelPath = undefined;
        if (!running || running.exitCode !== null) {
            return;
        }
        running.kill();
    }

    protected async resolveExecutables(configuration: LocalRuntimeConfiguration): Promise<string[]> {
        const extension = process.platform === 'win32' ? '.exe' : '';
        const candidates = [
            configuration.llamaServerPath,
            process.env.STRIGOI_LLAMA_SERVER_PATH,
            path.join(process.resourcesPath ?? '', 'app', 'electron-app', 'resources', 'runtime', 'llama.cpp', 'rocm', `llama-server${extension}`),
            path.join(process.resourcesPath ?? '', 'app', 'electron-app', 'resources', 'runtime', 'llama.cpp', 'vulkan', `llama-server${extension}`),
            path.join(process.resourcesPath ?? '', 'app', 'electron-app', 'resources', 'runtime', 'llama.cpp', 'cpu', `llama-server${extension}`),
            path.join(process.cwd(), 'electron-app', 'resources', 'runtime', 'llama.cpp', 'rocm', `llama-server${extension}`),
            path.join(process.cwd(), 'electron-app', 'resources', 'runtime', 'llama.cpp', 'vulkan', `llama-server${extension}`),
            path.join(process.cwd(), 'electron-app', 'resources', 'runtime', 'llama.cpp', 'cpu', `llama-server${extension}`),
            path.join(process.resourcesPath ?? '', 'runtime', 'llama.cpp', `llama-server${extension}`)
        ].filter((candidate): candidate is string => !!candidate);
        const executables: string[] = [];
        for (const candidate of candidates) {
            if (!await this.exists(candidate)) {
                continue;
            }
            const backend = path.basename(path.dirname(candidate)).toLowerCase();
            // A ROCm executable can still start in CPU-only mode. Do not let it
            // intercept NVIDIA/Intel machines unless it reports a real ROCm GPU.
            if (backend === 'rocm' && !await this.resolveBackendDevice(candidate, 'ROCm')) {
                continue;
            }
            executables.push(candidate);
        }
        return executables;
    }

    protected async resolveBackendDevice(executable: string, prefix: 'ROCm' | 'Vulkan'): Promise<string | undefined> {
        const cacheKey = `${executable}|${prefix}`;
        if (this.backendDeviceCache.has(cacheKey)) {
            return this.backendDeviceCache.get(cacheKey);
        }
        const output = await new Promise<string>(resolve => {
            execFile(executable, ['--list-devices'], { windowsHide: true, timeout: 10000 }, (_error, stdout, stderr) => {
                resolve(`${stdout ?? ''}\n${stderr ?? ''}`);
            });
        });
        const devices = output.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.startsWith(prefix))
            .map(line => ({ id: line.split(':', 1)[0], description: line.toLowerCase() }));
        const preferred = devices.find(device =>
            device.description.includes('nvidia') ||
            device.description.includes('radeon rx') ||
            device.description.includes('intel arc')
        ) ?? devices[0];
        this.backendDeviceCache.set(cacheKey, preferred?.id);
        return preferred?.id;
    }

    protected async resolveModelPath(configuration: LocalRuntimeConfiguration): Promise<string | undefined> {
        if (configuration.llamaModelPath && await this.exists(configuration.llamaModelPath)) {
            return configuration.llamaModelPath;
        }
        const installerModel = await this.installerModelPath(configuration);
        if (installerModel) {
            return installerModel;
        }
        const directory = await this.modelsDirectory(configuration);
        if (!await this.exists(directory)) {
            return undefined;
        }
        const selected = await this.selectedModelPath(directory);
        if (selected) {
            return selected;
        }
        const directPath = path.join(directory, `${configuration.expectedModel}.gguf`);
        if (await this.exists(directPath)) {
            return directPath;
        }
        return (await this.modelPaths(directory))[0];
    }

    protected async modelsDirectory(configuration: LocalRuntimeConfiguration): Promise<string> {
        if (configuration.modelsDirectory) {
            return configuration.modelsDirectory;
        }
        const installed = await this.installerRuntimeConfiguration();
        const adjacentToInstallation = process.resourcesPath
            ? path.join(path.dirname(process.resourcesPath), 'models')
            : undefined;
        return installed?.modelsDirectory
            ?? process.env.STRIGOI_MODELS_DIRECTORY
            // An interrupted model setup can leave a valid GGUF without its
            // manifest. The installation-owned models folder is still the
            // canonical discovery location in that case.
            ?? adjacentToInstallation
            ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? process.cwd(), 'Strigoi', 'models');
    }

    protected async installerModelPath(configuration: LocalRuntimeConfiguration): Promise<string | undefined> {
        if (configuration.modelsDirectory || configuration.llamaModelPath) {
            return undefined;
        }
        const installed = await this.installerRuntimeConfiguration();
        if (!installed?.modelPath || !path.isAbsolute(installed.modelPath)) {
            return undefined;
        }
        return await this.exists(installed.modelPath) ? installed.modelPath : undefined;
    }

    protected async installerRuntimeConfiguration(): Promise<{ modelsDirectory?: string; modelPath?: string } | undefined> {
        const configurationPaths = [
            process.resourcesPath ? path.join(path.dirname(process.resourcesPath), 'local-runtime.json') : undefined,
            // Compatibility with installations produced before models were moved
            // next to the user-selected Strigoi directory.
            path.join(process.env.PROGRAMDATA ?? path.join(process.env.SystemDrive ?? 'C:', 'ProgramData'), 'Strigoi', 'local-runtime.json')
        ].filter((configurationPath): configurationPath is string => !!configurationPath);
        for (const configurationPath of configurationPaths) {
            try {
                const configuration = JSON.parse(await fs.readFile(configurationPath, 'utf8')) as {
                    schemaVersion?: unknown;
                    modelsDirectory?: unknown;
                    modelPath?: unknown;
                };
                if (configuration.schemaVersion !== 1 ||
                    (typeof configuration.modelsDirectory !== 'string' && typeof configuration.modelPath !== 'string')) {
                    continue;
                }
                return {
                    modelsDirectory: typeof configuration.modelsDirectory === 'string' && path.isAbsolute(configuration.modelsDirectory)
                        ? configuration.modelsDirectory
                        : undefined,
                    modelPath: typeof configuration.modelPath === 'string' && path.isAbsolute(configuration.modelPath)
                        ? configuration.modelPath
                        : undefined
                };
            } catch {
                // Try the compatibility location when this installation has no manifest yet.
            }
        }
        return undefined;
    }

    protected async selectedModelPath(directory: string): Promise<string | undefined> {
        try {
            const selection = JSON.parse(await fs.readFile(path.join(directory, 'strigoi-model-selection.json'), 'utf8')) as { activeModel?: unknown };
            if (typeof selection.activeModel !== 'string' || path.basename(selection.activeModel) !== selection.activeModel || !selection.activeModel.toLowerCase().endsWith('.gguf')) {
                return undefined;
            }
            const selected = path.join(directory, selection.activeModel);
            return await this.exists(selected) ? selected : undefined;
        } catch {
            return undefined;
        }
    }

    /** Supports model packs such as `models/Qwen3.8-27B-GGUF/model.gguf`. */
    protected async modelPaths(directory: string): Promise<string[]> {
        try {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            const models: string[] = [];
            for (const entry of entries) {
                const candidate = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    models.push(...await this.modelPaths(candidate));
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf') && !entry.name.toLowerCase().startsWith('mmproj')) {
                    models.push(candidate);
                }
            }
            return models.sort();
        } catch {
            return [];
        }
    }

    protected async waitForHealth(): Promise<void> {
        // A cold load of a large GGUF can take much longer than an HTTP health check.
        // Keep the UI responsive through its normal status refresh rather than killing a valid load early.
        for (let attempt = 0; attempt < 180; attempt++) {
            if (!this.process) {
                throw new Error('O runtime llama.cpp encerrou antes de ficar pronto.');
            }
            try {
                const response = await fetch(`${this.endpoint()}/health`);
                if (response.ok) {
                    return;
                }
            } catch {
                // The process can need a few seconds to load a GGUF.
            }
            await new Promise<void>(resolve => setTimeout(resolve, 500));
        }
        await this.unloadModel();
        throw new Error('O runtime llama.cpp não respondeu dentro do tempo esperado.');
    }

    protected status(configuration: LocalRuntimeConfiguration, state: LocalRuntimeStatus['state'], overrides: Partial<LocalRuntimeStatus> = {}): LocalRuntimeStatus {
        return {
            provider: 'llama.cpp',
            state,
            expectedModel: configuration.expectedModel,
            availableModelCount: 0,
            ...overrides
        };
    }

    protected endpoint(): string {
        return `http://${this.host}:${this.port}`;
    }

    protected async exists(candidate: string): Promise<boolean> {
        try {
            await fs.access(candidate);
            return true;
        } catch {
            return false;
        }
    }

    protected quantizationFromFilename(filename: string): string | undefined {
        return filename.match(/(Q\d(?:_[A-Z0-9]+)?|IQ\d_[A-Z0-9]+)/i)?.[1];
    }

    protected toModelDetails(filePath: string): LocalModelDetails {
        const filename = path.basename(filePath);
        return {
            name: path.basename(filename, path.extname(filename)),
            quantizationLevel: this.quantizationFromFilename(filename),
            filePath
        };
    }
}
