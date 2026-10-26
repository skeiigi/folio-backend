import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { one } from './db.js';
import { assert } from './errors.js';

export function createStorage(db, config) {
  if (config.storageDriver === 's3') {
    const s3 = new S3Client({ endpoint: config.s3.endpoint, region: config.s3.region, forcePathStyle: true, credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey } });
    return {
      async put(key, bytes, mime) { await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: bytes, ContentType: mime })); },
      async get(key) { const data = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key })); return Buffer.from(await data.Body.transformToByteArray()); },
      async remove(key) { await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key })); },
    };
  }
  return {
    put: (key, bytes) => db.query('INSERT INTO storage_objects(key,bytes) VALUES($1,$2)', [key, bytes]),
    async get(key) { const row = await one(db, 'SELECT bytes FROM storage_objects WHERE key=$1', [key]); assert(row,404,'Файл не найден.'); return Buffer.from(row.bytes); },
    remove: key => db.query('DELETE FROM storage_objects WHERE key=$1', [key]),
  };
}

export function validateFile(file, purpose, maxBytes) {
  assert(file && file.buffer?.length, 422, 'Выберите файл для загрузки.', 'FILE_REQUIRED');
  assert(file.size <= maxBytes, 413, 'Файл превышает допустимый размер.', 'FILE_TOO_LARGE');
  const b = file.buffer;
  let mime = '';
  if (b.length > 12 && b.subarray(0,4).toString('ascii') === 'glTF' && b.readUInt32LE(4) === 2 && b.readUInt32LE(8) === b.length) mime = 'model/gltf-binary';
  else if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
  else if (b[0] === 255 && b[1] === 216 && b[2] === 255) mime = 'image/jpeg';
  else if (b.subarray(0,6).toString().match(/^GIF8[79]a$/)) mime = 'image/gif';
  else if (b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP') mime = 'image/webp';
  else if (b.subarray(4,8).toString() === 'ftyp') mime = 'video/mp4';
  const allowed = purpose === 'model' ? ['model/gltf-binary'] : purpose === 'preview' ? ['image/png','image/jpeg','image/webp','image/gif','video/mp4'] : ['image/png','image/jpeg','image/webp','image/gif'];
  assert(allowed.includes(mime), 422, purpose === 'model' ? 'Для 3D-просмотра нужен файл GLB версии 2.' : 'Поддерживаются PNG, JPEG, WebP, GIF; для анимации также MP4.', 'UNSUPPORTED_FILE');
  return mime;
}
export async function persistMedia(db, storage, file, { artworkId = null, briefId = null, purpose }, mime) {
  const id = randomUUID(); const key = `media/${id}`;
  await storage.put(key, file.buffer, mime);
  let old = [];
  try {
    const media = await db.transaction(async tx => {
      if (artworkId && ['cover','model'].includes(purpose)) {
        old = (await tx.query('DELETE FROM media_files WHERE artwork_id=$1 AND purpose=$2 RETURNING storage_key', [artworkId,purpose])).rows;
      }
      return one(tx, 'INSERT INTO media_files(id,artwork_id,brief_id,purpose,file_name,storage_key,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [id,artworkId,briefId,purpose,file.originalname.replace(/[\\/\x00-\x1f]/g,'_').slice(0,180),key,mime,file.size]);
    });
    for (const row of old) await storage.remove(row.storage_key).catch(() => {});
    return media;
  } catch(e) { await storage.remove(key).catch(() => {}); throw e; }
}
