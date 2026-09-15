export function validarDestinoB2(input) {
  const bucket = typeof input.bucket === 'string' ? input.bucket.trim() : '';
  let endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{4,61}[a-zA-Z0-9]$/.test(bucket))
    throw Object.assign(new Error('Informe o nome do bucket B2 (6 a 63 letras, números ou hífens).'), { status: 400 });
  if (!endpoint.startsWith('https://')) endpoint = `https://${endpoint}`;
  const match = /^https:\/\/s3\.([a-z]{2}-[a-z]+-\d{3})\.backblazeb2\.com\/?$/.exec(endpoint);
  if (!match) throw Object.assign(new Error('Informe o endpoint S3 do bucket, como s3.us-east-005.backblazeb2.com.'), { status: 400 });
  if (input.region && input.region !== match[1])
    throw Object.assign(new Error('A região deve corresponder ao endpoint do bucket.'), { status: 400 });
  return { bucket, endpoint: endpoint.replace(/\/$/, ''), region: match[1] };
}

export function destinoConfigurado(config) {
  return { bucket: config?.b2_bucket || process.env.B2_BUCKET_NAME || '',
    endpoint: config?.b2_endpoint || process.env.B2_ENDPOINT || '',
    region: config?.b2_region || process.env.B2_REGION || '' };
}
