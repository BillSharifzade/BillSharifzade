#!/usr/bin/env node
// Renders assets/stats-dark.svg and assets/stats-light.svg from the GitHub GraphQL API.
// Zero dependencies. Node 20+. Needs GITHUB_TOKEN (the default Actions token is enough).

import { writeFile, mkdir } from 'node:fs/promises'

const LOGIN = process.env.GH_LOGIN || 'BillSharifzade'
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
if (!TOKEN) {
  console.error('GITHUB_TOKEN is not set')
  process.exit(1)
}

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${LOGIN}-profile-stats`,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json, null, 2))
  return json.data
}

const PROFILE = `
query($login: String!, $after: String) {
  user(login: $login) {
    createdAt
    followers { totalCount }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`

const CONTRIBUTIONS = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`

async function fetchProfile() {
  let after = null
  let createdAt, followers, totalRepos
  const repos = []
  do {
    const { user } = await gql(PROFILE, { login: LOGIN, after })
    createdAt = user.createdAt
    followers = user.followers.totalCount
    totalRepos = user.repositories.totalCount
    repos.push(...user.repositories.nodes)
    after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null
  } while (after)
  return { createdAt, followers, totalRepos, repos }
}

// contributionsCollection accepts at most one year per call; walk from account creation to now.
async function fetchContributions(createdAt) {
  const now = new Date()
  const days = new Map()
  let commits = 0
  let total = 0
  let from = new Date(createdAt)
  while (from < now) {
    const to = new Date(Math.min(from.getTime() + 364 * 86400e3, now.getTime()))
    const { user } = await gql(CONTRIBUTIONS, { login: LOGIN, from: from.toISOString(), to: to.toISOString() })
    const c = user.contributionsCollection
    commits += c.totalCommitContributions
    total += c.contributionCalendar.totalContributions
    for (const w of c.contributionCalendar.weeks)
      for (const d of w.contributionDays) days.set(d.date, d.contributionCount)
    from = new Date(to.getTime() + 86400e3)
  }
  const lastYearFrom = new Date(now.getTime() - 365 * 86400e3)
  const { user } = await gql(CONTRIBUTIONS, { login: LOGIN, from: lastYearFrom.toISOString(), to: now.toISOString() })
  return {
    days,
    commitsAllTime: commits,
    totalAllTime: total,
    lastYear: user.contributionsCollection.contributionCalendar.totalContributions,
    commitsLastYear: user.contributionsCollection.totalCommitContributions,
  }
}

function streaks(days) {
  const sorted = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  let longest = 0
  let run = 0
  for (const [, n] of sorted) {
    run = n > 0 ? run + 1 : 0
    if (run > longest) longest = run
  }
  // Current streak: today counts if it has activity, otherwise start from yesterday.
  let i = sorted.length - 1
  if (i >= 0 && sorted[i][1] === 0) i--
  let current = 0
  while (i >= 0 && sorted[i][1] > 0) {
    current++
    i--
  }
  return { current, longest }
}

function languages(repos, limit = 6) {
  const bytes = new Map()
  for (const r of repos)
    for (const e of r.languages.edges) {
      const cur = bytes.get(e.node.name) ?? { size: 0, color: e.node.color ?? '#8b8b96' }
      cur.size += e.size
      bytes.set(e.node.name, cur)
    }
  const all = [...bytes.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.size - a.size)
  const sum = all.reduce((s, l) => s + l.size, 0) || 1
  const top = all.slice(0, limit)
  const rest = all.slice(limit).reduce((s, l) => s + l.size, 0)
  const out = top.map((l) => ({ ...l, share: l.size / sum }))
  if (rest > 0) out.push({ name: 'Other', color: '#8b8b96', size: rest, share: rest / sum })
  return out
}

const fmt = (n) => n.toLocaleString('en-US')
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const monthYear = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

const THEMES = {
  dark: { bg: '#0a0a0e', border: '#232330', text: '#e8dede', dim: '#8b8b96', accent: '#818cf8', track: '#1c1c26' },
  light: { bg: '#ffffff', border: '#e5e7eb', text: '#111827', dim: '#6b7280', accent: '#6366f1', track: '#eef0f4' },
}
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function render(theme, data) {
  const t = THEMES[theme]
  const W = 900
  const H = 240
  const pad = 32
  const cols = [
    { value: data.lastYear, label: 'contributions · 12 mo' },
    { value: data.totalRepos, label: 'public repos' },
    { value: data.stars, label: 'stars earned' },
    { value: data.followers, label: 'followers' },
  ]
  const colW = (W - pad * 2) / cols.length

  const statCells = cols
    .map(
      (c, i) => `
    <g transform="translate(${pad + i * colW} 0)">
      <text x="0" y="104" font-family="${SANS}" font-size="36" font-weight="700" fill="${t.text}" letter-spacing="-0.5">${fmt(c.value)}</text>
      <text x="1" y="126" font-family="${MONO}" font-size="12" fill="${t.dim}">${esc(c.label)}</text>
    </g>`,
    )
    .join('')

  const barX = pad
  const barY = 190
  const barW = W - pad * 2
  const barH = 10
  let x = barX
  const segments = data.langs
    .map((l) => {
      const w = Math.max(barW * l.share, 2)
      const s = `<rect x="${x.toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}" fill="${l.color}"/>`
      x += w
      return s
    })
    .join('')

  let lx = barX
  const legend = data.langs
    .map((l) => {
      const label = `${l.name} ${(l.share * 100).toFixed(0)}%`
      const s = `
    <circle cx="${lx + 4}" cy="219" r="4" fill="${l.color}"/>
    <text x="${lx + 14}" y="223" font-family="${MONO}" font-size="12.5" fill="${t.dim}">${esc(label)}</text>`
      lx += 14 + label.length * 8 + 22
      return s
    })
    .join('')

  const streak = `${data.current} day${data.current === 1 ? '' : 's'}`
  const longest = `${data.longest} day${data.longest === 1 ? '' : 's'}`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="s-title">
  <title id="s-title">GitHub activity for ${esc(LOGIN)}: ${fmt(data.lastYear)} contributions in the last 12 months, ${fmt(data.commitsAllTime)} commits all time, current streak ${streak}</title>
  <defs>
    <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}"/></clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${t.bg}" stroke="${t.border}"/>

  <text x="${pad}" y="40" font-family="${MONO}" font-size="12" fill="${t.accent}" letter-spacing="2.5">GITHUB ACTIVITY</text>
  <text x="${W - pad}" y="40" text-anchor="end" font-family="${MONO}" font-size="12" fill="${t.dim}">refreshed ${data.refreshed} · on GitHub since ${esc(data.since)}</text>
  ${statCells}

  <g font-family="${MONO}" font-size="13" fill="${t.dim}">
    <path d="M13.5 146 L5.5 157.5 h6 l-1.5 8.5 8 -11.5 h-6 z" fill="${t.accent}" transform="translate(${pad - 2} 0)"/>
    <text x="${pad + 20}" y="160"><tspan fill="${t.text}" font-weight="600">${streak}</tspan> current streak <tspan fill="${t.accent}">·</tspan> <tspan fill="${t.text}" font-weight="600">${longest}</tspan> longest <tspan fill="${t.accent}">·</tspan> <tspan fill="${t.text}" font-weight="600">${fmt(data.totalAllTime)}</tspan> contributions since ${esc(data.since)}</text>
  </g>

  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="${t.track}"/>
  <g clip-path="url(#bar)">${segments}</g>
  ${legend}
</svg>
`
}

const profile = await fetchProfile()
const contrib = await fetchContributions(profile.createdAt)
const { current, longest } = streaks(contrib.days)
const data = {
  ...contrib,
  current,
  longest,
  followers: profile.followers,
  totalRepos: profile.totalRepos,
  stars: profile.repos.reduce((s, r) => s + r.stargazerCount, 0),
  langs: languages(profile.repos),
  since: monthYear(profile.createdAt),
  refreshed: new Date().toISOString().slice(0, 10),
}

await mkdir('assets', { recursive: true })
for (const theme of Object.keys(THEMES)) await writeFile(`assets/stats-${theme}.svg`, render(theme, data))

console.log(
  JSON.stringify(
    {
      lastYear: data.lastYear,
      commitsAllTime: data.commitsAllTime,
      totalAllTime: data.totalAllTime,
      current,
      longest,
      repos: data.totalRepos,
      stars: data.stars,
      followers: data.followers,
      langs: data.langs.map((l) => `${l.name} ${(l.share * 100).toFixed(1)}%`),
    },
    null,
    2,
  ),
)
