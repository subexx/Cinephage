import { createPlayHandlers } from '../stremio-play';

export const { GET, HEAD, OPTIONS } = createPlayHandlers('mp4');
