import { db } from '$lib/server/db/index.js';
import { blocklist, movies, series } from '$lib/server/db/schema.js';
import { eq, or, and, gt, isNull, lte, inArray, count, sql, type SQL } from 'drizzle-orm';

export type BlocklistReason =
	| 'download_failed'
	| 'import_failed'
	| 'quality_mismatch'
	| 'manual'
	| 'duplicate'
	| 'bad_release'
	| 'blocked_extension';

export interface BlocklistCheckRelease {
	title: string;
	score?: number;
	size?: number;
	quality?: {
		resolution?: string;
		source?: string;
		codec?: string;
		hdr?: string;
	};
	indexerId?: string;
	infoHash?: string;
	downloadUrl?: string;
	magnetUrl?: string;
	protocol?: 'torrent' | 'usenet' | 'streaming' | string;
}

export interface BlocklistCheckOptions {
	movieId?: string;
	seriesId?: string;
}

export interface BlocklistCheckResult {
	blocked: boolean;
	reason?: string;
}

export interface BlocklistAddRelease {
	title: string;
	infoHash?: string;
	indexerId?: string;
	quality?: {
		resolution?: string;
		source?: string;
		codec?: string;
		hdr?: string;
	};
	size?: number;
	protocol?: string;
}

export interface BlocklistAddOptions {
	movieId?: string;
	seriesId?: string;
	episodeIds?: string[];
	reason: BlocklistReason;
	message?: string;
	expiresInHours?: number;
}

export interface BlocklistQueryOptions {
	movieId?: string;
	seriesId?: string;
	reason?: string;
	protocol?: string;
	activeOnly?: boolean;
	search?: string;
	limit?: number;
	offset?: number;
}

export interface BlocklistCountOptions {
	movieId?: string;
	seriesId?: string;
	reason?: string;
	protocol?: string;
	activeOnly?: boolean;
	search?: string;
}

class BlocklistService {
	private static instance: BlocklistService;

	static getInstance(): BlocklistService {
		if (!BlocklistService.instance) {
			BlocklistService.instance = new BlocklistService();
		}
		return BlocklistService.instance;
	}

	/**
	 * Condition matching entries for a library item, including entries detached
	 * when that item was deleted earlier (trigger, migration v157) and later re-added.
	 */
	private async targetCondition(
		movieId: string | undefined,
		seriesId: string | undefined
	): Promise<SQL | undefined> {
		if (movieId) {
			const movie = await db.query.movies.findFirst({
				where: eq(movies.id, movieId),
				columns: { tmdbId: true }
			});
			return or(
				eq(blocklist.movieId, movieId),
				movie
					? and(
							isNull(blocklist.movieId),
							eq(blocklist.tmdbId, movie.tmdbId),
							eq(blocklist.mediaType, 'movie')
						)
					: undefined
			);
		}
		if (seriesId) {
			const show = await db.query.series.findFirst({
				where: eq(series.id, seriesId),
				columns: { tmdbId: true }
			});
			return or(
				eq(blocklist.seriesId, seriesId),
				show
					? and(
							isNull(blocklist.seriesId),
							eq(blocklist.tmdbId, show.tmdbId),
							eq(blocklist.mediaType, 'tv')
						)
					: undefined
			);
		}
		return undefined;
	}

	async isBlocklisted(
		release: BlocklistCheckRelease,
		options: BlocklistCheckOptions
	): Promise<BlocklistCheckResult> {
		const now = new Date().toISOString();

		const conditions = [];

		if (release.infoHash) {
			conditions.push(eq(blocklist.infoHash, release.infoHash));
		}

		// Usenet releases have no hash: match the release name on any indexer. The
		// same post is listed by every indexer (NZBGeek, NZBFinder, ...), so scoping
		// a title block to the indexer it was added from let the copy on the other
		// indexer straight through. Case-insensitive: some sources re-case names.
		if (release.title) {
			conditions.push(sql`lower(${blocklist.sourceTitle}) = ${release.title.trim().toLowerCase()}`);
		}

		if (conditions.length === 0) {
			return { blocked: false };
		}

		const entries = await db.query.blocklist.findMany({
			where: and(
				or(...conditions),
				await this.targetCondition(options.movieId, options.seriesId),
				or(isNull(blocklist.expiresAt), gt(blocklist.expiresAt, now))
			),
			limit: 1
		});

		if (entries.length > 0) {
			const entry = entries[0];
			return {
				blocked: true,
				reason: `Blocklisted: ${entry.reason}${entry.message ? ` - ${entry.message}` : ''}`
			};
		}

		return { blocked: false };
	}

	async getBlockedIdentifiers(
		movieId?: string,
		seriesId?: string
	): Promise<{ blockedHashes: Set<string>; blockedTitles: Set<string> }> {
		const now = new Date().toISOString();

		const entries = await db.query.blocklist.findMany({
			where: and(
				await this.targetCondition(movieId, seriesId),
				or(isNull(blocklist.expiresAt), gt(blocklist.expiresAt, now))
			),
			columns: { infoHash: true, sourceTitle: true }
		});

		const blockedHashes = new Set(entries.map((e) => e.infoHash).filter(Boolean) as string[]);
		// Lower-cased: compare with release.title.trim().toLowerCase()
		const blockedTitles = new Set(
			entries
				.map((e) => e.sourceTitle?.trim().toLowerCase())
				.filter((title): title is string => !!title)
		);

		return { blockedHashes, blockedTitles };
	}

	/**
	 * Blocklist a queue/download item by title (and infoHash when present).
	 * Usenet releases have no torrent hash, so title matching is required.
	 * Omit expiresInHours for a permanent entry.
	 */
	addFromQueueItem(
		item: {
			title: string;
			infoHash?: string | null;
			indexerId?: string | null;
			quality?: BlocklistAddRelease['quality'] | null;
			size?: number | null;
			protocol?: string | null;
			movieId?: string | null;
			seriesId?: string | null;
			episodeIds?: string[] | null;
		},
		options: { reason: BlocklistReason; message?: string; expiresInHours?: number }
	): string | null {
		if (!item.title && !item.infoHash) {
			return null;
		}

		return this.addToBlocklist(
			{
				title: item.title || item.infoHash || 'unknown',
				infoHash: item.infoHash ?? undefined,
				indexerId: item.indexerId ?? undefined,
				quality: item.quality ?? undefined,
				size: item.size ?? undefined,
				protocol: item.protocol ?? undefined
			},
			{
				movieId: item.movieId ?? undefined,
				seriesId: item.seriesId ?? undefined,
				episodeIds: item.episodeIds ?? undefined,
				reason: options.reason,
				message: options.message,
				expiresInHours: options.expiresInHours
			}
		);
	}

	addToBlocklist(release: BlocklistAddRelease, options: BlocklistAddOptions): string {
		const expiresAt = options.expiresInHours
			? new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000).toISOString()
			: null;

		const dedupConditions = [eq(blocklist.title, release.title)];
		if (options.movieId) dedupConditions.push(eq(blocklist.movieId, options.movieId));
		if (options.seriesId) dedupConditions.push(eq(blocklist.seriesId, options.seriesId));
		if (release.infoHash) dedupConditions.push(eq(blocklist.infoHash, release.infoHash));
		else if (release.indexerId)
			dedupConditions.push(
				or(eq(blocklist.indexerId, release.indexerId), isNull(blocklist.indexerId))!
			);

		db.delete(blocklist)
			.where(and(...dedupConditions))
			.run();

		const [entry] = db
			.insert(blocklist)
			.values({
				title: release.title,
				infoHash: release.infoHash ?? null,
				indexerId: release.indexerId ?? null,
				movieId: options.movieId ?? null,
				seriesId: options.seriesId ?? null,
				episodeIds: options.episodeIds ?? null,
				reason: options.reason,
				message: options.message ?? null,
				sourceTitle: release.title,
				quality: release.quality ?? null,
				size: release.size ?? null,
				protocol: release.protocol ?? null,
				expiresAt
			})
			.returning()
			.all();

		return entry.id;
	}

	async removeFromBlocklist(id: string): Promise<void> {
		await db.delete(blocklist).where(eq(blocklist.id, id));
	}

	async clearMovieBlocklist(movieId: string): Promise<void> {
		await db.delete(blocklist).where(eq(blocklist.movieId, movieId));
	}

	async clearSeriesBlocklist(seriesId: string): Promise<void> {
		await db.delete(blocklist).where(eq(blocklist.seriesId, seriesId));
	}

	async getBlocklist(options?: BlocklistQueryOptions): Promise<(typeof blocklist.$inferSelect)[]> {
		const conditions = [];

		if (options?.movieId) conditions.push(eq(blocklist.movieId, options.movieId));
		if (options?.seriesId) conditions.push(eq(blocklist.seriesId, options.seriesId));
		if (options?.reason) conditions.push(eq(blocklist.reason, options.reason));
		if (options?.protocol) conditions.push(eq(blocklist.protocol, options.protocol));
		if (options?.activeOnly) {
			const now = new Date().toISOString();
			conditions.push(or(isNull(blocklist.expiresAt), gt(blocklist.expiresAt, now)));
		}

		return db.query.blocklist.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			limit: options?.limit ?? 100,
			offset: options?.offset ?? 0,
			orderBy: (blocklist, { desc }) => [desc(blocklist.createdAt)]
		});
	}

	async cleanExpiredEntries(): Promise<number> {
		const now = new Date().toISOString();
		await db.delete(blocklist).where(lte(blocklist.expiresAt, now));

		return 0;
	}

	async getBlocklistCount(options?: BlocklistCountOptions): Promise<number> {
		const conditions = [];

		if (options?.movieId) conditions.push(eq(blocklist.movieId, options.movieId));
		if (options?.seriesId) conditions.push(eq(blocklist.seriesId, options.seriesId));
		if (options?.reason) conditions.push(eq(blocklist.reason, options.reason));
		if (options?.protocol) conditions.push(eq(blocklist.protocol, options.protocol));
		if (options?.activeOnly) {
			const now = new Date().toISOString();
			conditions.push(or(isNull(blocklist.expiresAt), gt(blocklist.expiresAt, now)));
		}

		const [result] = await db
			.select({ count: count() })
			.from(blocklist)
			.where(conditions.length > 0 ? and(...conditions) : undefined);

		return result.count;
	}

	async removeFromBlocklistByIds(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		for (let i = 0; i < ids.length; i += 500) {
			await db.delete(blocklist).where(inArray(blocklist.id, ids.slice(i, i + 500)));
		}
	}

	async updateExpiry(id: string, expiresInHours: number | null): Promise<void> {
		const expiresAt =
			expiresInHours !== null
				? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
				: null;
		await db.update(blocklist).set({ expiresAt }).where(eq(blocklist.id, id));
	}
}

export const blocklistService = BlocklistService.getInstance();
