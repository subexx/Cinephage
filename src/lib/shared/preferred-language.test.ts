import { describe, expect, it } from 'vitest';
import {
	classifyReleaseAudio,
	isEnglishAudioUpgrade,
	orderReleasesByPreferredAudio,
	resolveConcreteLanguage,
	resolveSubtitleLanguageCodes
} from './preferred-language.js';

describe('classifyReleaseAudio', () => {
	it('treats English and multi as preferred', () => {
		expect(classifyReleaseAudio(['en'], 'ja')).toBe('preferred');
		expect(classifyReleaseAudio(['multi'], 'ja')).toBe('preferred');
	});

	it('treats the title original as fallback when it is not English', () => {
		expect(classifyReleaseAudio(['ja'], 'ja')).toBe('fallback');
		expect(classifyReleaseAudio(['orig'], 'ko')).toBe('fallback');
	});

	it('rejects other dubbed languages on non-English originals', () => {
		expect(classifyReleaseAudio(['de'], 'ja')).toBe('other');
		expect(classifyReleaseAudio(['fr'], 'ko')).toBe('other');
	});

	it('treats unlabeled and orig as preferred when the original is English', () => {
		expect(classifyReleaseAudio([], 'en')).toBe('preferred');
		expect(classifyReleaseAudio(['orig'], 'en')).toBe('preferred');
		expect(classifyReleaseAudio(['de'], 'en')).toBe('other');
	});
});

describe('isEnglishAudioUpgrade', () => {
	it('upgrades original-language copies when English appears', () => {
		expect(isEnglishAudioUpgrade(['ja'], ['en'], 'ja')).toBe(true);
		expect(isEnglishAudioUpgrade(['en'], ['en'], 'ja')).toBe(false);
		expect(isEnglishAudioUpgrade(['ja'], ['ja'], 'ja')).toBe(false);
	});
});

describe('resolveConcreteLanguage', () => {
	it('passes through real codes and skips original when it is English or unknown', () => {
		expect(resolveConcreteLanguage('en', 'ja')).toBe('en');
		expect(resolveConcreteLanguage('original', 'ja')).toBe('ja');
		expect(resolveConcreteLanguage('original', 'en')).toBeNull();
		expect(resolveConcreteLanguage('original', null)).toBeNull();
	});
});

describe('resolveSubtitleLanguageCodes', () => {
	it('expands original and drops duplicates of English', () => {
		expect(resolveSubtitleLanguageCodes(['en', 'original'], 'ja')).toEqual(['en', 'ja']);
		expect(resolveSubtitleLanguageCodes(['en', 'original'], 'en')).toEqual(['en']);
	});
});

describe('orderReleasesByPreferredAudio', () => {
	it('ranks English ahead of original even when original scores higher', () => {
		const ordered = orderReleasesByPreferredAudio(
			[
				{ parsed: { languages: ['ja'] }, totalScore: 900 },
				{ parsed: { languages: ['en'] }, totalScore: 100 }
			],
			'ja'
		);
		expect(ordered[0].parsed?.languages).toEqual(['en']);
	});
});
