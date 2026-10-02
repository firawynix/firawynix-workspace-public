import { injectable } from '@theia/core/shared/inversify';
import { WebSearchResult, WebSearchService } from '../common/web-search-service';

const SEARCH_TIMEOUT_MS = 12_000;
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 8;

@injectable()
export class WebSearchServiceImpl implements WebSearchService {
    async search(query: string, maxResults = 5): Promise<WebSearchResult[]> {
        const normalizedQuery = query.trim().replace(/\s+/g, ' ');
        if (!normalizedQuery) {
            throw new Error('Informe uma consulta para pesquisar na web.');
        }
        if (normalizedQuery.length > MAX_QUERY_LENGTH) {
            throw new Error(`A consulta deve ter no máximo ${MAX_QUERY_LENGTH} caracteres.`);
        }

        const limit = Math.max(1, Math.min(MAX_RESULTS, Math.floor(maxResults)));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
        try {
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(normalizedQuery)}`;
            const response = await fetch(url, {
                headers: {
                    accept: 'text/html,application/xhtml+xml',
                    'user-agent': 'Strigoi/0.1 (local web search)'
                },
                signal: controller.signal,
                redirect: 'follow'
            });
            if (!response.ok) {
                throw new Error(`O provedor de busca retornou HTTP ${response.status}.`);
            }
            const html = await response.text();
            return this.parseResults(html).slice(0, limit);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new Error('A pesquisa excedeu o limite de 12 segundos.');
            }
            throw error instanceof Error ? error : new Error('Não foi possível pesquisar na web.');
        } finally {
            clearTimeout(timeout);
        }
    }

    protected parseResults(html: string): WebSearchResult[] {
        const results: WebSearchResult[] = [];
        // Split on the next top-level result instead of the first nested div pair;
        // DuckDuckGo places the snippet after a nested URL metadata block.
        const blockPattern = /<div[^>]+class="result results_links[^>]*>([\s\S]*?)(?=<div[^>]+class="result results_links|$)/gi;
        let block: RegExpExecArray | null;
        while ((block = blockPattern.exec(html)) !== null && results.length < MAX_RESULTS) {
            const titleMatch = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block[1]);
            if (!titleMatch) {
                continue;
            }
            const url = this.resolveResultUrl(titleMatch[1]);
            if (!url) {
                continue;
            }
            const snippetMatch = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i.exec(block[1]);
            results.push({
                title: this.decodeHtml(titleMatch[2]),
                url,
                snippet: this.decodeHtml(snippetMatch?.[1] ?? snippetMatch?.[2] ?? '')
            });
        }
        return results;
    }

    protected resolveResultUrl(rawUrl: string): string | undefined {
        try {
            const parsed = new URL(this.decodeHtml(rawUrl), 'https://html.duckduckgo.com');
            if (parsed.hostname.endsWith('duckduckgo.com') && parsed.searchParams.has('uddg')) {
                return this.safeUrl(parsed.searchParams.get('uddg') ?? '');
            }
            return this.safeUrl(parsed.toString());
        } catch {
            return undefined;
        }
    }

    protected safeUrl(rawUrl: string): string | undefined {
        try {
            const parsed = new URL(rawUrl);
            return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
        } catch {
            return undefined;
        }
    }

    protected decodeHtml(value: string): string {
        return value
            .replace(/<[^>]*>/g, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
            .replace(/\s+/g, ' ')
            .trim();
    }
}
