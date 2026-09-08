import type { RequestHandler } from './$types';
import { GET as launchGet, HEAD as launchHead, OPTIONS as launchOptions } from '../+server';

/**
 * Stremio / Nuvio players sniff by path extension. Serving launch media at
 * `/master.m3u8` (instead of redirecting to the extension-less Jellyfin URL)
 * keeps Direct Play working for those clients while .strm files can still use
 * the suffix-free route.
 */
export const GET: RequestHandler = launchGet;
export const HEAD: RequestHandler = launchHead;
export const OPTIONS: RequestHandler = launchOptions;
