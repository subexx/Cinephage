import type { DecisionStage, StageResult } from '../../types.js';
import type { GrabDecisionContext } from './types.js';
import { ReleaseParser } from '$lib/server/indexers/parser/ReleaseParser.js';
import { classifyReleaseAudio } from '$lib/shared/preferred-language.js';

const parser = new ReleaseParser();

/**
 * Automatic grabs keep English audio, or the title's original language when
 * English is not on the indexer. Other dubs are skipped until English appears.
 */
export class AudioLanguageStage implements DecisionStage<GrabDecisionContext> {
	name = 'audioLanguage';

	isEnabled(ctx: GrabDecisionContext): boolean {
		return ctx.options.isAutomatic && !ctx.options.force;
	}

	async evaluate(ctx: GrabDecisionContext): Promise<StageResult> {
		const languages = parser.parse(ctx.release.title).languages;
		const classification = classifyReleaseAudio(languages, ctx.originalLanguage ?? null);

		if (classification === 'other') {
			return {
				accepted: false,
				reason:
					'Audio language is not English or the original language; waiting for English or original',
				details: { rejectionType: 'wrong_language', audioLanguage: classification, languages }
			};
		}

		return { accepted: true, details: { audioLanguage: classification, languages } };
	}
}
