/** Règles de téléversement par usage. Toute image est ré-encodée côté serveur (métadonnées EXIF/GPS supprimées). */
export type FilePurpose = 'AVATAR' | 'VERIFICATION_DOC';

export interface FileRule {
  visibility: 'PUBLIC' | 'PRIVATE';
  mimeTypes: string[];
  maxBytes: number;
}

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

export const FILE_RULES: Record<FilePurpose, FileRule> = {
  AVATAR: { visibility: 'PUBLIC', mimeTypes: IMAGES, maxBytes: 10 * 1024 * 1024 },
  VERIFICATION_DOC: { visibility: 'PRIVATE', mimeTypes: [...IMAGES, 'application/pdf'], maxBytes: 10 * 1024 * 1024 },
};

export const MAX_IMAGE_SIDE = 2048;
/** Protection contre les « bombes de décompression » (images minuscules en octets mais gigantesques en pixels). */
export const MAX_INPUT_PIXELS = 40_000_000;
