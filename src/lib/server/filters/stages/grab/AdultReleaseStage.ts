import type { DecisionStage, StageResult } from '../../types.js';
import type { GrabDecisionContext } from './types.js';

/**
 * Fork: reject adult releases before grabbing (fake uploads posted under a
 * real film's title, wrong-title matches on short names). Runs for forced /
 * manual grabs too. Newznab/Torznab category 6xxx is the XXX tree.
 */
const ADULT_MARKERS = [
	'xxx',
	'porn',
	'porno',
	'brazzers',
	'bangbros',
	'bang vault',
	'reality ?kings',
	'naughty ?america',
	'nubile ?films',
	'nubiles',
	'kinky ?family',
	'team ?skeet',
	'mofos',
	'evil ?angel',
	'digital ?playground',
	'blacked',
	'tushy',
	'only ?fans',
	'milf',
	'blowjob',
	'creampie',
	'cumshot',
	'gangbang',
	'deepthroat',
	'handjob',
	'hard cock'
];

const ADULT_PATTERN = new RegExp(
	`(?:^|[^a-z0-9])(?:${ADULT_MARKERS.join('|')})(?=[^a-z0-9]|$)`,
	'i'
);

export function isAdultRelease(title: string, category?: string): boolean {
	if (category && /^6\d{3}$/.test(category.trim())) return true;
	return ADULT_PATTERN.test(title.replace(/[._-]+/g, ' '));
}

export class AdultReleaseStage implements DecisionStage<GrabDecisionContext> {
	name = 'adultRelease';

	isEnabled(_ctx: GrabDecisionContext): boolean {
		return true;
	}

	async evaluate(ctx: GrabDecisionContext): Promise<StageResult> {
		if (!isAdultRelease(ctx.release.title, ctx.release.category)) return { accepted: true };
		return {
			accepted: false,
			reason: 'Banned: adult content',
			details: { rejectionType: 'banned', bannedReasons: ['adult content'] }
		};
	}
}
