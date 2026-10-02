export const FIRAWMERGE_SERVICE_PATH = '/services/firawynix/firawmerge';
export const FirawMergeService = Symbol('FirawMergeService');

export interface FirawMergeService {
    findExecutable(): Promise<string | undefined>;
    launch(executable: string, localPaths: string[]): Promise<void>;
}
