/**
 * Durée d'un fichier audio MP4/M4A (AAC), lue dans l'en-tête « mvhd ». Retourne null si l'en-tête est absent
 * ou illisible : le fichier est alors refusé, faute de pouvoir vérifier sa durée.
 */
export function mp4DurationSeconds(buf: Buffer): number | null {
  const moov = findBox(buf, 0, buf.length, 'moov');
  if (!moov) return null;
  const mvhd = findBox(buf, moov.start, moov.end, 'mvhd');
  if (!mvhd || mvhd.end - mvhd.start < 24) return null;
  const version = buf.readUInt8(mvhd.start);
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (mvhd.end - mvhd.start < 32) return null;
    timescale = buf.readUInt32BE(mvhd.start + 20);
    duration = Number(buf.readBigUInt64BE(mvhd.start + 24));
  } else {
    timescale = buf.readUInt32BE(mvhd.start + 12);
    duration = buf.readUInt32BE(mvhd.start + 16);
  }
  if (!timescale) return null;
  return duration / timescale;
}

/** Cherche une boîte de premier niveau entre `from` et `to` ; renvoie les bornes de son contenu. */
function findBox(buf: Buffer, from: number, to: number, type: string): { start: number; end: number } | null {
  let offset = from;
  while (offset + 8 <= to) {
    let size = buf.readUInt32BE(offset);
    const name = buf.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > to) return null;
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < header || offset + size > to) return null;
    if (name === type) return { start: offset + header, end: offset + size };
    offset += size;
  }
  return null;
}
