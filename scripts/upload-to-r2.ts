/// <reference types="node" />

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

function getClient(): S3Client {
  const accountId = process.env.CF_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId) throw new Error('CF_ACCOUNT_ID is not set');
  if (!accessKeyId) throw new Error('R2_ACCESS_KEY_ID is not set');
  if (!secretAccessKey) throw new Error('R2_SECRET_ACCESS_KEY is not set');

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Uploads a text string to Cloudflare R2.
 *
 * @param key    - The object key (path) within the bucket, e.g. "kenpalinc/index.txt"
 * @param content - The text content to upload
 */
export async function uploadToR2(key: string, content: string): Promise<void> {
  const bucketName = process.env.R2_BUCKET_NAME ?? 'kenpal-chatbot';
  const client = getClient();

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: content,
    ContentType: 'text/plain; charset=utf-8',
  });

  await client.send(command);
}
