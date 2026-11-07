/**
 * Fork: library file verification.
 *
 * Catches fake / wrong-content releases that pass the name-based grab filters
 * (e.g. a clip posted under a Malayalam film's name):
 *  - runtime: the probed file length is far off the movie's TMDB runtime;
 *  - language: for originals listed in ORIGINAL_AUDIO_LANGS, the probed audio
 *    carries no language tag AND the release name names no language either.
 *
 * Used at import (reject before the file enters the library) and by the
 * "Verify library files" tasks (report / fix) over files already imported.
 */

import { basename } from 'path';
import { db } from '$lib/server/db';
import { movieFiles, movies } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { extractLanguages } from '$lib/server/indexers/parser/patterns/language';
import { normalizeLanguageCode } from '$lib/shared/languages';
import { originalAudioLangs } from '$lib/server/languages/audio-preference-resolver';
import { createChildLogger } from '$lib/logging';

const logger = createChildLogger({ module: 'FileVerification', logDomain: 'scans' as const });

/** Below this share of the expected runtime the file is treated as wrong content. */
const MIN_RUNTIME_RATIO = 0.6;
/** Above this multiple of the expected runtime the file is treated as wrong content. */
const MAX_RUNTIME_RATIO = 2.0;
/** Short films are skipped: their TMDB runtime is too unreliable to judge. */
const MIN_EXPECTED_MINUTES = 40;

/** Run the automatic (fix) sweep weekly; the first run is a week after start. */
export const VERIFY_SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface VerifyMovieFileInput {
	/** Movie runtime from TMDB, minutes. */
	movieRuntimeMinutes?: number | null;
	/** Movie original language (ISO 639-1). */
	originalLanguage?: string | null;
	/** Probed media info; null/undefined means "not probed" and is never punished. */
	mediaInfo?: { runtime?: number; audioLanguages?: string[] } | null;
	/** Release / scene name and file name, checked for a language token. */
	names?: Array<string | null | undefined>;
}

function usableTag(tag: unknown): boolean {
	return typeof tag === 'string' && tag.trim() !== '' && tag.trim().toLowerCase() !== 'und';
}

/** Returns a human-readable rejection reason, or null when the file looks right. */
export function verifyMovieFile(input: VerifyMovieFileInput): string | null {
	const info = input.mediaInfo;
	if (!info) return null;

	const expected = input.movieRuntimeMinutes ?? 0;
	const actualSeconds = info.runtime ?? 0;
	if (expected >= MIN_EXPECTED_MINUTES && actualSeconds > 0) {
		const ratio = actualSeconds / (expected * 60);
		if (ratio < MIN_RUNTIME_RATIO || ratio > MAX_RUNTIME_RATIO) {
			return `Runtime mismatch: file is ${Math.round(actualSeconds / 60)} min, movie is ${expected} min`;
		}
	}

	const original = input.originalLanguage ? normalizeLanguageCode(input.originalLanguage) : '';
	if (original && originalAudioLangs().has(original)) {
		const tagged = (info.audioLanguages ?? []).some(usableTag);
		const named = (input.names ?? []).some(
			(name) => !!name && extractLanguages(name.replace(/[._]+/g, ' ')).languages.length > 0
		);
		if (!tagged && !named) {
			return `Untagged audio and no language in release name (original language: ${original})`;
		}
	}

	return null;
}

export interface VerifySuspect {
	movieId: string;
	fileId: string;
	title: string;
	year: number | null;
	file: string;
	reason: string;
	removed?: boolean;
	error?: string;
}

export interface VerifyLibraryResult {
	success: true;
	mode: 'report' | 'fix';
	total: number;
	failed: number;
	updated: number;
	suspects: VerifySuspect[];
	message: string;
}

let sweepRunning = false;

/** Check every movie file already in the library; in fix mode delete, blocklist and re-search. */
export async function verifyLibraryFiles(mode: 'report' | 'fix'): Promise<VerifyLibraryResult> {
	if (sweepRunning) throw new Error('Library verification is already running');
	sweepRunning = true;
	try {
		const rows = await db
			.select({
				fileId: movieFiles.id,
				movieId: movieFiles.movieId,
				relativePath: movieFiles.relativePath,
				sceneName: movieFiles.sceneName,
				mediaInfo: movieFiles.mediaInfo,
				title: movies.title,
				year: movies.year,
				runtime: movies.runtime,
				originalLanguage: movies.originalLanguage
			})
			.from(movieFiles)
			.innerJoin(movies, eq(movies.id, movieFiles.movieId));

		const suspects: VerifySuspect[] = [];
		for (const row of rows) {
			const reason = verifyMovieFile({
				movieRuntimeMinutes: row.runtime,
				originalLanguage: row.originalLanguage,
				mediaInfo: row.mediaInfo,
				names: [row.sceneName, basename(row.relativePath)]
			});
			if (!reason) continue;
			suspects.push({
				movieId: row.movieId,
				fileId: row.fileId,
				title: row.title,
				year: row.year ?? null,
				file: row.sceneName || basename(row.relativePath),
				reason
			});
		}

		let updated = 0;
		if (mode === 'fix') {
			for (const suspect of suspects) {
				const ok = await removeSuspect(suspect);
				if (ok) updated++;
			}
		}

		const failed = mode === 'fix' ? suspects.length - updated : 0;
		const lines = suspects
			.slice(0, 40)
			.map(
				(s) =>
					`${s.title}${s.year ? ` (${s.year})` : ''}: ${s.reason} [${s.file}]${
						mode === 'fix' ? (s.removed ? ' - removed' : ` - NOT removed: ${s.error}`) : ''
					}`
			);
		const head =
			mode === 'report'
				? `${suspects.length} suspect file(s) of ${rows.length} (report only, nothing deleted)`
				: `${updated} of ${suspects.length} suspect file(s) removed and re-searched (${rows.length} checked)`;
		const message = [
			head,
			...lines,
			suspects.length > 40 ? `...and ${suspects.length - 40} more` : ''
		]
			.filter(Boolean)
			.join('\n');

		logger.info({ mode, total: rows.length, suspects: suspects.length, updated }, message);
		return { success: true, mode, total: rows.length, failed, updated, suspects, message };
	} finally {
		sweepRunning = false;
	}
}

async function removeSuspect(suspect: VerifySuspect): Promise<boolean> {
	try {
		const { importService } = await import('$lib/server/downloadClients/import/ImportService.js');
		const deleted = await importService.deleteMovieFile(suspect.fileId, suspect.movieId);
		if (!deleted.success) {
			suspect.error = deleted.error ?? 'delete failed';
			return false;
		}
		suspect.removed = true;

		const remaining = await db
			.select({ id: movieFiles.id })
			.from(movieFiles)
			.where(eq(movieFiles.movieId, suspect.movieId))
			.limit(1);
		await db
			.update(movies)
			.set({
				...(remaining.length === 0 ? { hasFile: false } : {}),
				lastSearchTime: new Date(0).toISOString()
			})
			.where(eq(movies.id, suspect.movieId));

		const { blocklistService } = await import('$lib/server/blocklist/BlocklistService.js');
		blocklistService.addFromQueueItem(
			{ title: suspect.file, movieId: suspect.movieId },
			{ reason: 'bad_release', message: suspect.reason }
		);

		// Fire-and-forget: indexer latency must not hold the task request open.
		void (async () => {
			try {
				const { monitoringSearchService } =
					await import('$lib/server/monitoring/search/MonitoringSearchService.js');
				await monitoringSearchService.searchReplacementForMovie(suspect.movieId);
			} catch (error) {
				logger.warn(
					{
						movieId: suspect.movieId,
						error: error instanceof Error ? error.message : String(error)
					},
					'Replacement search after verification failed'
				);
			}
		})();
		return true;
	} catch (error) {
		suspect.error = error instanceof Error ? error.message : String(error);
		return false;
	}
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start the weekly automatic fix sweep (first run one interval after start). */
export function startLibraryVerificationSchedule(): void {
	if (sweepTimer) return;
	sweepTimer = setInterval(() => {
		verifyLibraryFiles('fix').catch((error) =>
			logger.warn(
				{ error: error instanceof Error ? error.message : String(error) },
				'Scheduled library verification failed'
			)
		);
	}, VERIFY_SWEEP_INTERVAL_MS);
	sweepTimer.unref?.();
}
