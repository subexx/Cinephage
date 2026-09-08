import type { MigrationDefinition } from '../migration-helpers.js';
import { columnExists } from '../migration-helpers.js';
import { createChildLogger } from '$lib/logging';

const logger = createChildLogger({ logDomain: 'system' as const });

/**
 * Add desired_qualities to smart_lists so auto-add can keep multiple resolution tiers.
 */
export const migration_v137: MigrationDefinition = {
	version: 137,
	name: 'add_smart_list_desired_qualities',
	apply: (sqlite) => {
		if (!columnExists(sqlite, 'smart_lists', 'desired_qualities')) {
			sqlite.prepare(`ALTER TABLE smart_lists ADD COLUMN desired_qualities TEXT`).run();
			logger.info('[SchemaSync] Added desired_qualities column to smart_lists');
		}
	}
};
