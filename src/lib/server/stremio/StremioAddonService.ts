import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { episodeFiles, episodes, movieFiles, movies, series } from '$lib/server/db/schema';
import { RESOLUTION_ORDER, type Resolution } from '$lib/server/indexers/parser/types.js';
import { STREMIO_ADDON_ID, STREMIO_ADDON_VERSION } from './constants.js';
import {
	imdbLookupValues,
	parseStremioId,
	type ParsedStremioId,
	type StremioContentType
} from './ids.js';
import type { StremioManifest, StremioStream, StremioStreamResponse } from './types.js';
import {
	buildEpisodeLibraryFileUrl,
	buildEpisodeSessionUrl,
	buildMovieLibraryFileUrl,
	buildMovieSessionUrl,
	isStrmPath
} from './urls.js';
import {
	formatStreamLabels,
	mapAudioCodec,
	mapVideoCodec,
	type StremioAddonDisplaySettings,
	type StreamFormatInput
} from '$lib/shared/stremio-format.js';
import { DEFAULT_STREMIO_ADDON_SETTINGS } from '$lib/shared/stremio-format.js';

type Db = typeof db;

interface LibraryFile {
	id: string;
	relativePath: string;
	sceneName?: string | null;
	quality?: { resolution?: string; source?: string; codec?: string; hdr?: string } | null;
	size?: number | null;
	edition?: string | null;
	releaseGroup?: string | null;
	languages?: string[] | null;
	mediaInfo?: {
		containerFormat?: string;
		videoCodec?: string;
		videoHdrFormat?: string;
		audioCodec?: string;
		audioChannels?: number;
		audioBitrate?: number;
		videoBitrate?: number;
		audioLanguages?: string[];
	} | null;
}

function fileBasename(relativePath: string): string {
	return relativePath.split(/[\\/]/).pop() || relativePath;
}

function fileExtension(relativePath: string): string {
	const name = fileBasename(relativePath);
	const dot = name.lastIndexOf('.');
	return dot >= 0 ? name.slice(dot + 1).toUpperCase() : '';
}

function resolutionRank(resolution: string | undefined): number {
	return RESOLUTION_ORDER[(resolution as Resolution) ?? 'unknown'] ?? 0;
}

function fileHasEpisode(file: { episodeIds: string[] | null }, episodeId: string): boolean {
	return (file.episodeIds ?? []).includes(episodeId);
}

function sortStreamFiles<T extends LibraryFile>(files: T[]): T[] {
	return [...files].sort((a, b) => {
		const resDelta = resolutionRank(b.quality?.resolution) - resolutionRank(a.quality?.resolution);
		if (resDelta !== 0) return resDelta;
		const strmDelta = Number(isStrmPath(a.relativePath)) - Number(isStrmPath(b.relativePath));
		if (strmDelta !== 0) return strmDelta;
		return (b.size ?? 0) - (a.size ?? 0);
	});
}

function hdrLabel(file: LibraryFile): string {
	const raw = file.mediaInfo?.videoHdrFormat || file.quality?.hdr || '';
	if (!raw || raw.toUpperCase() === 'SDR') return '';
	return raw;
}

function toFormatInput(file: LibraryFile): StreamFormatInput {
	const filename = isStrmPath(file.relativePath)
		? file.sceneName || fileBasename(file.relativePath).replace(/\.strm$/i, '.mkv')
		: fileBasename(file.relativePath);
	const audio = mapAudioCodec(file.mediaInfo?.audioCodec, file.mediaInfo?.audioChannels);
	return {
		filename,
		resolution: file.quality?.resolution,
		video: mapVideoCodec(file.mediaInfo?.videoCodec || file.quality?.codec),
		hdr: hdrLabel(file),
		audio,
		channels: audio.match(/\b(\d+\.\d+|mono|\d+ch)\b/i)?.[1] || '',
		container: file.mediaInfo?.containerFormat?.toUpperCase() || fileExtension(file.relativePath),
		size: isStrmPath(file.relativePath) ? 0 : file.size,
		bitrate: file.mediaInfo?.videoBitrate,
		remux: file.quality?.source?.toLowerCase() === 'remux',
		edition: file.edition,
		languages: file.mediaInfo?.audioLanguages || file.languages
	};
}

export class StremioAddonService {
	constructor(private readonly database: Db = db) {}

	getManifest(addonName = DEFAULT_STREMIO_ADDON_SETTINGS.addonName): StremioManifest {
		return {
			id: STREMIO_ADDON_ID,
			version: STREMIO_ADDON_VERSION,
			name: addonName,
			description: 'Direct-play streams from your Cinephage library.',
			resources: [
				{
					name: 'stream',
					types: ['movie', 'series'],
					idPrefixes: ['tt', 'tmdb:', 'imdb:']
				}
			],
			types: ['movie', 'series'],
			idPrefixes: ['tt', 'tmdb:', 'imdb:'],
			catalogs: [],
			behaviorHints: {
				configurable: false,
				p2p: false
			}
		};
	}

	async getStreams(
		type: StremioContentType,
		rawId: string,
		baseUrl: string,
		apiKey: string,
		display: StremioAddonDisplaySettings = DEFAULT_STREMIO_ADDON_SETTINGS
	): Promise<StremioStreamResponse> {
		const parsed = parseStremioId(type, rawId);
		if (!parsed) return { streams: [] };

		if (type === 'movie') {
			return { streams: await this.movieStreams(parsed, baseUrl, apiKey, display) };
		}
		return { streams: await this.episodeStreams(parsed, baseUrl, apiKey, display) };
	}

	private async findMovie(parsed: ParsedStremioId) {
		if (parsed.imdbId) {
			const byImdb = await this.database
				.select()
				.from(movies)
				.where(inArray(movies.imdbId, imdbLookupValues(parsed.imdbId)))
				.get();
			if (byImdb) return byImdb;
		}
		if (parsed.tmdbId) {
			return this.database.select().from(movies).where(eq(movies.tmdbId, parsed.tmdbId)).get();
		}
		return undefined;
	}

	private async findSeries(parsed: ParsedStremioId) {
		if (parsed.imdbId) {
			const byImdb = await this.database
				.select()
				.from(series)
				.where(inArray(series.imdbId, imdbLookupValues(parsed.imdbId)))
				.get();
			if (byImdb) return byImdb;
		}
		if (parsed.tmdbId) {
			return this.database.select().from(series).where(eq(series.tmdbId, parsed.tmdbId)).get();
		}
		return undefined;
	}

	private async movieStreams(
		parsed: ParsedStremioId,
		baseUrl: string,
		apiKey: string,
		display: StremioAddonDisplaySettings
	): Promise<StremioStream[]> {
		const movie = await this.findMovie(parsed);
		if (!movie) return [];

		const files = await this.database
			.select({
				id: movieFiles.id,
				relativePath: movieFiles.relativePath,
				sceneName: movieFiles.sceneName,
				quality: movieFiles.quality,
				size: movieFiles.size,
				edition: movieFiles.edition,
				releaseGroup: movieFiles.releaseGroup,
				languages: movieFiles.languages,
				mediaInfo: movieFiles.mediaInfo
			})
			.from(movieFiles)
			.where(and(eq(movieFiles.movieId, movie.id), eq(movieFiles.contentCategory, 'main')));

		return sortStreamFiles(files).map((file) => {
			const basename = fileBasename(file.relativePath);
			return this.toStream({
				file,
				url: isStrmPath(file.relativePath)
					? buildMovieSessionUrl(baseUrl, movie.tmdbId, apiKey)
					: buildMovieLibraryFileUrl(baseUrl, file.id, apiKey, basename),
				bingeGroup: `${display.addonName}-${movie.id}-${file.quality?.resolution ?? 'unknown'}`,
				display
			});
		});
	}

	private async episodeStreams(
		parsed: ParsedStremioId,
		baseUrl: string,
		apiKey: string,
		display: StremioAddonDisplaySettings
	): Promise<StremioStream[]> {
		if (parsed.season === undefined || parsed.episode === undefined) return [];

		const show = await this.findSeries(parsed);
		if (!show) return [];

		const episode = await this.database
			.select({ id: episodes.id })
			.from(episodes)
			.where(
				and(
					eq(episodes.seriesId, show.id),
					eq(episodes.seasonNumber, parsed.season),
					eq(episodes.episodeNumber, parsed.episode)
				)
			)
			.get();
		if (!episode) return [];

		const files = await this.database
			.select({
				id: episodeFiles.id,
				relativePath: episodeFiles.relativePath,
				sceneName: episodeFiles.sceneName,
				quality: episodeFiles.quality,
				size: episodeFiles.size,
				edition: episodeFiles.edition,
				releaseGroup: episodeFiles.releaseGroup,
				languages: episodeFiles.languages,
				mediaInfo: episodeFiles.mediaInfo,
				episodeIds: episodeFiles.episodeIds
			})
			.from(episodeFiles)
			.where(and(eq(episodeFiles.seriesId, show.id), eq(episodeFiles.contentCategory, 'main')));

		const matching = files.filter((file) => fileHasEpisode(file, episode.id));

		return sortStreamFiles(matching).map((file) => {
			const basename = fileBasename(file.relativePath);
			return this.toStream({
				file,
				url: isStrmPath(file.relativePath)
					? buildEpisodeSessionUrl(baseUrl, show.tmdbId, parsed.season!, parsed.episode!, apiKey)
					: buildEpisodeLibraryFileUrl(baseUrl, file.id, apiKey, basename),
				bingeGroup: `${display.addonName}-${show.id}-${file.quality?.resolution ?? 'unknown'}`,
				display
			});
		});
	}

	private toStream(input: {
		file: LibraryFile;
		url: string;
		bingeGroup: string;
		display: StremioAddonDisplaySettings;
	}): StremioStream {
		const labels = formatStreamLabels(toFormatInput(input.file), input.display);
		const basename = fileBasename(input.file.relativePath);
		const filename = isStrmPath(input.file.relativePath)
			? basename.replace(/\.strm$/i, '.m3u8')
			: basename;
		return {
			name: labels.name,
			title: labels.name,
			url: input.url,
			description: labels.description,
			behaviorHints: {
				bingeGroup: input.bingeGroup,
				// Match AIOMedia Direct Play: mark non-transcode streams notWebReady so
				// Nuvio/Stremio use their external/native player path instead of HTML5-only.
				notWebReady: true,
				filename
			}
		};
	}
}

let instance: StremioAddonService | null = null;

export function getStremioAddonService(): StremioAddonService {
	if (!instance) {
		instance = new StremioAddonService();
	}
	return instance;
}
