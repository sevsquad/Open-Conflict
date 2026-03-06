import fs from 'fs';
const data = JSON.parse(fs.readFileSync('saves/Paris_0.1km_22x24_2026-03-06.json', 'utf8'));
const meta = data._meta;
if (meta) {
  console.log('Meta keys:', Object.keys(meta));
  if (meta.parseLog) {
    const log = meta.parseLog;
    const lines = typeof log === 'string' ? log.split('\n') : [];
    console.log('Parse log lines:', lines.length);
    for (const line of lines) {
      if (/worldcover|terrain|classif|tile|wcGrid|DEBUG|light_urban|open_ground|built-up|Tile N|cells classified/i.test(line)) {
        console.log(line);
      }
    }
  }
  if (meta.version) console.log('Version:', meta.version);
  if (meta.tier) console.log('Tier:', meta.tier);
  console.log('Urban detail:', meta.urbanDetail);
  console.log('Fine cell km:', meta.fineCellKm);
} else {
  console.log('No _meta in save');
  console.log('Top-level keys:', Object.keys(data));
}
