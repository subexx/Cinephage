import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/subtitles/services/LanguageProfileService', () => ({
	getLanguageProfileService: () => ({})
}));

import { verifyMovieFile } from './file-verification';

afterEach(() => {
	delete process.env.ORIGINAL_AUDIO_LANGS;
});

describe('verifyMovieFile', () => {
	it('rejects a file far shorter than the movie', () => {
		const reason = verifyMovieFile({
			movieRuntimeMinutes: 130,
			mediaInfo: { runtime: 25 * 60, audioLanguages: ['mal'] },
			names: ['Innocent.2025.Malayalam.1080p.WEB-DL']
		});
		expect(reason).toMatch(/Runtime mismatch/);
	});

	it('accepts a file close to the movie runtime', () => {
		expect(
			verifyMovieFile({
				movieRuntimeMinutes: 130,
				mediaInfo: { runtime: 128 * 60, audioLanguages: ['mal'] }
			})
		).toBeNull();
	});

	it('rejects untagged audio with no language in the name for listed originals', () => {
		process.env.ORIGINAL_AUDIO_LANGS = 'ml,hi,ta,te';
		const reason = verifyMovieFile({
			movieRuntimeMinutes: 130,
			originalLanguage: 'ml',
			mediaInfo: { runtime: 129 * 60, audioLanguages: ['und'] },
			names: ['Innocent.2025.1080p.WEB-DL.x264', 'Innocent.2025.1080p.mkv']
		});
		expect(reason).toMatch(/Untagged audio/);
	});

	it('accepts untagged audio when the release name has the language', () => {
		process.env.ORIGINAL_AUDIO_LANGS = 'ml,hi,ta,te';
		expect(
			verifyMovieFile({
				movieRuntimeMinutes: 130,
				originalLanguage: 'ml',
				mediaInfo: { runtime: 129 * 60, audioLanguages: [] },
				names: ['Innocent.2025.Malayalam.1080p.WEB-DL']
			})
		).toBeNull();
	});

	it('leaves other originals and unprobed files alone', () => {
		process.env.ORIGINAL_AUDIO_LANGS = 'ml,hi,ta,te';
		expect(
			verifyMovieFile({
				movieRuntimeMinutes: 120,
				originalLanguage: 'ko',
				mediaInfo: { runtime: 118 * 60, audioLanguages: [] },
				names: ['Some.Film.2024.1080p']
			})
		).toBeNull();
		expect(
			verifyMovieFile({ movieRuntimeMinutes: 120, originalLanguage: 'ml', mediaInfo: null })
		).toBeNull();
	});
});
