import { normalizeLanguageCode } from './languages.js';

/** Preferred audio (and subtitle cutoff) language. */
export const PREFERRED_AUDIO_LANGUAGE = 'en';

/** Language-profile sentinel resolved to the title's TMDB original language. */
export const ORIGINAL_LANGUAGE_SENTINEL = 'original';

/** Stable id for the built-in English-then-original language profile. */
export const ENGLISH_ORIGINAL_PROFILE_ID = 'lang-en-original';

export const ENGLISH_ORIGINAL_PROFILE_NAME = 'English + Original';

export type AudioLanguageClass = 'preferred' | 'fallback' | 'other';

const ENGLISH_CODES = new Set(['en', 'eng', 'english']);
const ORIGINAL_MARKERS = new Set(['orig', 'original']);
const MULTI_CODES = new Set(['multi']);

const CLASS_RANK: Record<AudioLanguageClass, number> = {
	preferred: 2,
	fallback: 1,
	other: 0
};

export function isEnglishLanguageCode(code: string | null | undefined): boolean {
	if (!code) return false;
	const normalized = normalizeLanguageCode(code);
	return ENGLISH_CODES.has(normalized) || normalized === PREFERRED_AUDIO_LANGUAGE;
}

export function classifyReleaseAudio(
	languages: string[] | null | undefined,
	originalLanguage: string | null | undefined
): AudioLanguageClass {
	const langs = (languages ?? []).map((language) => normalizeLanguageCode(language));
	const original = originalLanguage ? normalizeLanguageCode(originalLanguage) : null;
	const originalIsEnglish = !original || isEnglishLanguageCode(original);

	const hasEnglish = langs.some((language) => isEnglishLanguageCode(language) || MULTI_CODES.has(language));
	if (hasEnglish) return 'preferred';

	const hasOrigMarker = langs.some((language) => ORIGINAL_MARKERS.has(language));
	const hasOriginal =
		!!original && langs.some((language) => language === original || ORIGINAL_MARKERS.has(language));

	if (originalIsEnglish) {
		if (hasOrigMarker || langs.length === 0) return 'preferred';
		return 'other';
	}

	if (hasOriginal || hasOrigMarker) return 'fallback';
	if (langs.length === 0) return 'preferred';
	return 'other';
}

/** True when the candidate is English and the existing copy is not. */
export function isEnglishAudioUpgrade(
	existingLanguages: string[] | null | undefined,
	candidateLanguages: string[] | null | undefined,
	originalLanguage: string | null | undefined
): boolean {
	const existing = classifyReleaseAudio(existingLanguages, originalLanguage);
	const candidate = classifyReleaseAudio(candidateLanguages, originalLanguage);
	return candidate === 'preferred' && existing !== 'preferred';
}

/**
 * Map a profile language code to a real ISO code. `original` becomes the
 * title's original language, or null when that would duplicate English / is unknown.
 */
export function resolveConcreteLanguage(
	code: string,
	originalLanguage: string | null | undefined
): string | null {
	const normalized = normalizeLanguageCode(code);
	if (normalized !== ORIGINAL_LANGUAGE_SENTINEL && normalized !== 'orig') return normalized;
	if (!originalLanguage) return null;
	const original = normalizeLanguageCode(originalLanguage);
	if (isEnglishLanguageCode(original)) return null;
	return original;
}

export function resolveSubtitleLanguageCodes(
	codes: string[],
	originalLanguage: string | null | undefined
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const code of codes) {
		const concrete = resolveConcreteLanguage(code, originalLanguage);
		if (!concrete || seen.has(concrete)) continue;
		seen.add(concrete);
		out.push(concrete);
	}
	return out;
}

/** Higher preferred class first. 0 when equal. */
export function compareAudioPreference(
	aLangs: string[] | null | undefined,
	bLangs: string[] | null | undefined,
	originalLanguage: string | null | undefined
): number {
	return (
		CLASS_RANK[classifyReleaseAudio(bLangs, originalLanguage)] -
		CLASS_RANK[classifyReleaseAudio(aLangs, originalLanguage)]
	);
}

export function orderReleasesByPreferredAudio<
	T extends { parsed?: { languages?: string[] }; totalScore?: number }
>(releases: T[], originalLanguage: string | null | undefined): T[] {
	return [...releases].sort((a, b) => {
		const preference = compareAudioPreference(
			a.parsed?.languages,
			b.parsed?.languages,
			originalLanguage
		);
		if (preference !== 0) return preference;
		return (b.totalScore ?? 0) - (a.totalScore ?? 0);
	});
}

export function isBetterAudioRelease(
	candidateLangs: string[] | null | undefined,
	candidateScore: number,
	currentLangs: string[] | null | undefined,
	currentScore: number,
	originalLanguage: string | null | undefined
): boolean {
	const preference = compareAudioPreference(candidateLangs, currentLangs, originalLanguage);
	if (preference !== 0) return preference < 0;
	return candidateScore > currentScore;
}
