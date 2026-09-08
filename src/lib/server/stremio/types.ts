import type { StremioContentType } from './ids.js';

export interface StremioManifest {
	id: string;
	version: string;
	name: string;
	description: string;
	resources: Array<string | { name: string; types: StremioContentType[]; idPrefixes?: string[] }>;
	types: StremioContentType[];
	catalogs: StremioCatalogDefinition[];
	idPrefixes: string[];
	behaviorHints?: {
		adult?: boolean;
		p2p?: boolean;
		configurable?: boolean;
		configurationRequired?: boolean;
	};
}

export interface StremioCatalogDefinition {
	type: StremioContentType;
	id: string;
	name: string;
	extra?: Array<{ name: string; isRequired?: boolean }>;
}

export interface StremioMetaPreview {
	id: string;
	type: StremioContentType;
	name: string;
	poster?: string;
	posterShape?: 'poster' | 'square' | 'landscape';
	background?: string;
	releaseInfo?: string;
	imdbRating?: string;
	description?: string;
	genres?: string[];
}

export interface StremioVideo {
	id: string;
	title: string;
	released?: string;
	season?: number;
	episode?: number;
	overview?: string;
	thumbnail?: string;
	available?: boolean;
}

export interface StremioMeta extends StremioMetaPreview {
	background?: string;
	logo?: string;
	runtime?: string;
	year?: string;
	videos?: StremioVideo[];
}

export interface StremioStream {
	name: string;
	title: string;
	url: string;
	description?: string;
	behaviorHints?: {
		bingeGroup?: string;
		notWebReady?: boolean;
		filename?: string;
	};
}

export interface StremioCatalogResponse {
	metas: StremioMetaPreview[];
}

export interface StremioMetaResponse {
	meta: StremioMeta;
}

export interface StremioStreamResponse {
	streams: StremioStream[];
}
