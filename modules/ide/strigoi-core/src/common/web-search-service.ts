export const WEB_SEARCH_SERVICE_PATH = '/services/strigoi/web-search';
export const WebSearchService = Symbol('WebSearchService');

export type WebSearchMode = 'off' | 'auto' | 'on';

export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
}

export interface WebSearchService {
    search(query: string, maxResults?: number): Promise<WebSearchResult[]>;
}
