import { Handler } from '@netlify/functions';

const VPS_URL = 'http://5.223.78.194';

export const handler: Handler = async (event) => {
  const authHeader = event.headers.authorization || '';
  const contentType = event.headers['content-type'] || '';
  const path = event.path.replace('/.netlify/functions/proxy-upload', '/api/invoices/upload-madison');

  try {
    const response = await fetch(`${VPS_URL}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': contentType,
      },
      body: event.body,
      signal: AbortSignal.timeout(540000), // 9 minutes
    });

    const data = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
      body: data,
    };
  } catch (error: any) {
    return {
      statusCode: 504,
      body: JSON.stringify({ error: { message: error.message || 'Upload proxy timeout', status: 504 } }),
    };
  }
};
