import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/subtitles/services/LanguageProfileService', () => ({
	getLanguageProfileService: () => ({})
}));

import { materializeAudioPreference } from './audio-preference-resolver';

const englishProfile = { preferOriginal: true, languages: ['en'], mode: 'prefer' as const };

afterEach(() => {
	delete process.env.ORIGINAL_AUDIO_LANGS;
});

describe('materializeAudioPreference ORIGINAL_AUDIO_LANGS', () => {
	it('requires original audio for listed originals', () => {
		process.env.ORIGINAL_AUDIO_LANGS = 'ml,hi,ta,te';
		expect(materializeAudioPreference(englishProfile, 'ml')).toEqual({
			preferOriginal: true,
			languages: [],
			originalLanguage: 'ml',
			mode: 'require'
		});
	});

	it('keeps the profile for other originals', () => {
		process.env.ORIGINAL_AUDIO_LANGS = 'ml,hi,ta,te';
		const pref = materializeAudioPreference(englishProfile, 'ko');
		expect(pref.mode).toBe('prefer');
		expect(pref.languages).toEqual(['en']);
	});

	it('is a no-op when unset', () => {
		expect(materializeAudioPreference(englishProfile, 'ml').mode).toBe('prefer');
	});
});
