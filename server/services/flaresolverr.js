import fetch from 'node-fetch';

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';

export async function isAvailable() {
  try {
    const res = await fetch(FLARESOLVERR_URL, { method: 'POST', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function solveChallenge(url, options = {}) {
  const body = {
    cmd: 'request.get',
    url,
    maxTimeout: options.timeout || 60000,
  };

  if (options.cookies) {
    body.cookies = options.cookies;
  }

  if (options.proxy) {
    body.proxy = options.proxy;
  }

  const res = await fetch(FLARESOLVERR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 90000,
  });

  const data = await res.json();

  if (data.status !== 'ok') {
    throw new Error(data.message || 'FlareSolverr challenge failed');
  }

  return {
    html: data.solution.response,
    cookies: data.solution.cookies,
    userAgent: data.solution.userAgent,
    status: data.solution.status,
  };
}

export async function solvePost(url, postData, options = {}) {
  const body = {
    cmd: 'request.post',
    url,
    postData: typeof postData === 'string' ? postData : JSON.stringify(postData),
    maxTimeout: options.timeout || 60000,
  };

  const res = await fetch(FLARESOLVERR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 90000,
  });

  const data = await res.json();

  if (data.status !== 'ok') {
    throw new Error(data.message || 'FlareSolverr POST failed');
  }

  return {
    html: data.solution.response,
    cookies: data.solution.cookies,
    userAgent: data.solution.userAgent,
  };
}
