import type { RequestHandler } from './$types';
import { GET as baseGet, HEAD as baseHead } from '../+server';

/**
 * Filename suffix is for player sniffing only (e.g. Nuvio/Stremio).
 * Auth and bytes come from the fileId route.
 */
export const GET: RequestHandler = async (event) => baseGet(event as never);
export const HEAD: RequestHandler = async (event) => baseHead(event as never);
