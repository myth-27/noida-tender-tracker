import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 500 });
  }

  const res = await fetch(
    'https://api.github.com/repos/myth-27/noida-tender-tracker/actions/workflows/scrape-tenders.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'noida-tender-tracker',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  );

  if (res.status === 204) {
    return NextResponse.json({ ok: true });
  }

  const body = await res.text();
  return NextResponse.json({ error: body }, { status: res.status });
}
