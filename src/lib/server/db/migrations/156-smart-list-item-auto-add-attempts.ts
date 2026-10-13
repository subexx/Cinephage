import type { MigrationDefinition } from '../migration-helpers.js';
import { columnExists } from '../migration-helpers.js';
import { createChildLogger } from '$lib/logging';

const logger = createChildLogger({ logDomain: 'system' as const });

/**
 * Track failed auto-add attempts per smart list item so a title that keeps failing
 * stops occupying the auto-add batch and the rest of the list can drain.
 */
export const migration_v156: MigrationDefinition = {
	version: 156,
	name: 'smart_list_item_auto_add_attempts',
	apply: (sqlite) => {
		if (!columnExists(sqlite, 'smart_list_items', 'auto_add_attempts')) {
			sqlite
				.prepare(`ALTER TABLE smart_list_items ADD COLUMN auto_add_attempts INTEGER DEFAULT 0`)
				.run();
			logger.info('[SchemaSync] Added auto_add_attempts column to smart_list_items');
		}
		if (!columnExists(sqlite, 'smart_list_items', 'last_auto_add_attempt_at')) {
			sqlite.prepare(`ALTER TABLE smart_list_items ADD COLUMN last_auto_add_attempt_at TEXT`).run();
			logger.info('[SchemaSync] Added last_auto_add_attempt_at column to smart_list_items');
		}
		if (!columnExists(sqlite, 'smart_list_items', 'last_auto_add_error')) {
			sqlite.prepare(`ALTER TABLE smart_list_items ADD COLUMN last_auto_add_error TEXT`).run();
			logger.info('[SchemaSync] Added last_auto_add_error column to smart_list_items');
		}
	}
};
