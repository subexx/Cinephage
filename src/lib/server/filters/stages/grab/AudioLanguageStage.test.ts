import { describe, expect, it } from 'vitest';
import { AudioLanguageStage } from './AudioLanguageStage.js';
import { makeGrabDecisionContext } from '../../../../../test/fixtures/filters.js';

const stage = new AudioLanguageStage();

describe('AudioLanguageStage', () => {
	it('is only enabled for automatic grabs', () => {
		expect(stage.isEnabled(makeGrabDecisionContext({ options: { force: false, skipBlocklist: false, allowSidegrade: false, isAutomatic: true } }))).toBe(
			true
		);
		expect(stage.isEnabled(makeGrabDecisionContext({ options: { force: false, skipBlocklist: false, allowSidegrade: false, isAutomatic: false } }))).toBe(
			false
		);
	});

	it('accepts English audio', async () => {
		const ctx = makeGrabDecisionContext({
			release: { title: 'Movie.2024.1080p.WEB-DL.English', protocol: 'torrent' },
			originalLanguage: 'ja'
		});
		const result = await stage.evaluate(ctx);
		expect(result.accepted).toBe(true);
	});

	it('accepts original-language audio when English is missing', async () => {
		const ctx = makeGrabDecisionContext({
			release: { title: 'Movie.2024.1080p.WEB-DL.Japanese', protocol: 'torrent' },
			originalLanguage: 'ja'
		});
		const result = await stage.evaluate(ctx);
		expect(result.accepted).toBe(true);
	});

	it('rejects other dubbed languages on automatic grabs', async () => {
		const ctx = makeGrabDecisionContext({
			release: { title: 'Movie.2024.1080p.WEB-DL.German', protocol: 'torrent' },
			originalLanguage: 'ja'
		});
		const result = await stage.evaluate(ctx);
		expect(result.accepted).toBe(false);
		expect(result.details?.rejectionType).toBe('wrong_language');
	});
});
