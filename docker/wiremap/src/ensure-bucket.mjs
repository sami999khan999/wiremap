// Creates the bucket the app stores graphs in, if it is missing. Run by the container's
// bootstrap step on every start; MinIO answers "already owned" when it exists.
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const env = process.env;
const client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});
try {
  await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
} catch {
  await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  process.stdout.write(`wiremap: created bucket ${env.S3_BUCKET}\n`);
}
