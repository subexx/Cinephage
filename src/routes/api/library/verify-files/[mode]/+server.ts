import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth/authorization.js';
import { verifyLibraryFiles } from '$lib/server/library/file-verification.js';

/** Fork: POST /api/library/verify-files/{report|fix} */
export const POST: RequestHandler = async (event) => {
	const authError = requireAdmin(event);
	if (authError) return authError;

	const mode = event.params.mode;
	if (mode !== 'report' && mode !== 'fix') {
		return json({ success: false, error: `Unknown mode '${mode}'` }, { status: 400 });
	}

	try {
		return json(await verifyLibraryFiles(mode));
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return json({ success: false, error: message, message }, { status: 500 });
	}
};
