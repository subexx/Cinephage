/**
 * Read-only smart list / library diagnostic.
 *
 * Run inside the container:
 *   docker exec -i cinephage node - < scripts/diagnose-smartlists.cjs
 *
 * Opens the database read-only and prints aggregate stats only.
 */
const path = require('path');
const Database = require(
	path.join(process.env.APP_DIR || '/app', 'node_modules', 'better-sqlite3')
);

const dbPath = path.join(process.env.DATA_DIR || '/config/data', 'cinephage.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const all = (sql, ...args) => db.prepare(sql).all(...args);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const print = (title, rows) => {
	console.log(`\n=== ${title} ===`);
	if (Array.isArray(rows)) console.table(rows);
	else console.log(rows);
};

print('Schema version', get(`SELECT * FROM settings WHERE key = 'schema_version'`) ?? 'n/a');

print('Library totals', {
	movies: get(`SELECT count(*) n FROM movies`).n,
	moviesMonitored: get(`SELECT count(*) n FROM movies WHERE monitored = 1`).n,
	moviesWithFile: get(`SELECT count(*) n FROM movies WHERE has_file = 1`).n,
	series: get(`SELECT count(*) n FROM series`).n
});

print(
	'Movies added per day (last 10 days)',
	all(`SELECT substr(added, 1, 10) day, count(*) movies FROM movies
	     WHERE added >= date('now', '-10 days') GROUP BY day ORDER BY day`)
);

print(
	'Where movies added in the last 10 days came from',
	all(`SELECT
	       CASE
	         WHEN EXISTS (SELECT 1 FROM smart_list_items i WHERE i.movie_id = m.id AND i.was_auto_added = 1)
	           THEN 'smart list auto-add'
	         WHEN EXISTS (SELECT 1 FROM smart_list_items i WHERE i.tmdb_id = m.tmdb_id AND i.media_type = 'movie')
	           THEN 'on a smart list, added another way'
	         ELSE 'not on any smart list'
	       END source,
	       count(*) movies
	     FROM movies m WHERE m.added >= date('now', '-10 days') GROUP BY source`)
);

print(
	'Smart lists',
	all(`SELECT l.name, l.media_type type, l.enabled, l.preset_provider provider,
	       l.auto_add_behavior auto_add, l.refresh_interval_hours every_h,
	       rf.path root_folder, rf.read_only rf_read_only,
	       l.cached_item_count cached, l.items_in_library in_lib, l.items_auto_added auto_added,
	       l.last_refresh_status last_status, substr(l.last_refresh_time, 1, 16) last_refresh,
	       substr(l.next_refresh_time, 1, 16) next_refresh
	     FROM smart_lists l LEFT JOIN root_folders rf ON rf.id = l.root_folder_id`)
);

print(
	'Smart list items (live counts)',
	all(`SELECT l.name,
	       sum(i.position < 9999) on_list,
	       sum(i.position >= 9999) dropped_off,
	       sum(i.in_library = 1) in_library,
	       sum(i.was_auto_added = 1) auto_added,
	       sum(i.is_excluded = 1) excluded,
	       sum(coalesce(i.auto_add_attempts, 0) > 0) failing,
	       sum(coalesce(i.auto_add_attempts, 0) >= 3) backed_off,
	       count(DISTINCT i.tmdb_id) distinct_tmdb
	     FROM smart_lists l JOIN smart_list_items i ON i.smart_list_id = l.id GROUP BY l.id`)
);

print(
	'Overlap: list items vs library (by TMDB id)',
	all(`SELECT l.name,
	       sum(EXISTS (SELECT 1 FROM movies m WHERE m.tmdb_id = i.tmdb_id)) movie_tmdb_match,
	       sum(EXISTS (SELECT 1 FROM series s WHERE s.tmdb_id = i.tmdb_id)) series_tmdb_match,
	       sum(i.in_library = 1) flagged_in_library
	     FROM smart_lists l JOIN smart_list_items i ON i.smart_list_id = l.id GROUP BY l.id`)
);

print(
	'Top auto-add errors',
	all(`SELECT substr(last_auto_add_error, 1, 120) error, count(*) items
	     FROM smart_list_items WHERE last_auto_add_error IS NOT NULL
	     GROUP BY error ORDER BY items DESC LIMIT 10`)
);

print(
	'Recent refreshes (last 15)',
	all(`SELECT l.name, h.refresh_type type, h.status, substr(h.started_at, 1, 16) started,
	       round(h.duration_ms / 60000.0, 1) minutes, h.items_found found, h.items_new new,
	       h.items_auto_added auto_added, substr(h.error_message, 1, 100) error
	     FROM smart_list_refresh_history h JOIN smart_lists l ON l.id = h.smart_list_id
	     ORDER BY h.started_at DESC LIMIT 15`)
);

db.close();
