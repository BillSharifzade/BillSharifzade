#!/usr/bin/env node
// Builds the "Stack" rows in the README (assets/stack-*.svg) from local tiles, in the same
// layout skillicons.dev uses: 256px tiles on a 300px pitch, rendered at 48px high.
//
//   icons/skillicons/*.svg  tiles vendored from tandpfun/skill-icons (MIT), used as-is
//   icons/logos/*.svg       official marks for tools skillicons lacks, fitted onto a tile here
//   icons/wordmarks/*.svg   tiles for tools with no logo at all (see wordmark-tile.py)
//
//   node scripts/stack.mjs [--preview out.svg]   (preview = every row stacked, for eyeballing)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TILE = 256, PITCH = 300, OUT_H = 48, BG = '#242938', RX = 60;

// How each official mark sits on its tile. `viewBox` is the mark's measured ink box (so it
// centres exactly), `box` the square in tile px it is fitted into — skillicons marks span
// roughly 170px when square and ~200–210px when they are wide wordmarks.
const LOGOS = {
  tokio:   { viewBox: '0 0.4 120 106.8',         box: 172, recolor: { '#000000': '#FFFFFF' } },
  ratatui: { viewBox: '0 0 50 50',                box: 170, fill: '#FFFFFF' },
  hyper:   { viewBox: '4.95 6.75 35.17 31.5',     box: 176 },
  chi:     { viewBox: '19.63 70.83 217.6 113.49', box: 204 },
  numpy:   { viewBox: '55.83 42.5 388.33 415',    box: 178 },
  pandas:  { viewBox: '35.74 29.76 138.74 220.56', box: 180 },
  opengl:  { viewBox: '1.07 36.48 126.72 53.97',  box: 208, recolor: { '#B3B3B3': '#D7DCE5', '#999': '#AEB6C4' } },
  vulkan:  { viewBox: '0 46.93 128 34.13',        box: 210 },
  gentoo:  { viewBox: '2.77 0 122.45 128',        box: 172 },
  systemd: { viewBox: '64 74 172 52',             box: 200, drop: [/<path fill="#201a26"[^>]*\/>/] },
};

// Row name -> tiles. Prefixes: sk (skillicons), logo (icons/logos), wm (icons/wordmarks).
const ROWS = {
  languages: ['sk:Rust', 'sk:GoLang', 'sk:Python-Dark', 'sk:TypeScript'],
  rust:      ['wm:axum', 'sk:Actix-Dark', 'logo:tokio', 'logo:hyper', 'wm:sqlx', 'sk:Tauri-Dark', 'logo:ratatui'],
  'go-py':   ['logo:chi', 'wm:pgx', 'sk:FastAPI', 'logo:numpy', 'logo:pandas', 'sk:TensorFlow-Dark'],
  web:       ['sk:NextJS-Dark', 'sk:React-Dark', 'sk:NodeJS-Dark', 'sk:Bun-Dark'],
  lowlevel:  ['sk:C', 'sk:Zig-Dark', 'wm:asm', 'logo:opengl', 'logo:vulkan'],
  infra:     ['sk:PostgreSQL-Dark', 'sk:Redis-Dark', 'sk:Kafka', 'sk:Docker', 'sk:Nginx', 'sk:Git', 'sk:GithubActions-Dark', 'sk:GitLab-Dark'],
  linux:     ['sk:Linux-Dark', 'sk:Arch-Dark', 'logo:gentoo', 'sk:Kali-Dark', 'logo:systemd', 'sk:Bash-Dark'],
};

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

// Strip editor cruft and inline <style> classes so a mark can be embedded safely.
function clean(svg) {
  svg = svg
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(title|desc|metadata)\b[\s\S]*?<\/\1>/g, '')
    .replace(/<(sodipodi|inkscape):([\w-]+)\b[^>]*\/>/g, '')
    .replace(/<(sodipodi|inkscape):([\w-]+)\b[\s\S]*?<\/\1:\2>/g, '')
    .replace(/\s(sodipodi|inkscape):[\w-]+="[^"]*"/g, '')
    .replace(/\sxmlns:(sodipodi|inkscape|dc|cc|rdf|svg)="[^"]*"/g, '')
    .replace(/\sdata-name="[^"]*"/g, '');
  const style = svg.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (style) {
    const rules = {};
    for (const m of style[1].matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) rules[m[1]] = m[2].trim().replace(/;$/, '');
    svg = svg.replace(/<defs>\s*<style[\s\S]*?<\/style>\s*<\/defs>/, '').replace(/<style[\s\S]*?<\/style>/, '');
    // Inline style outranks a class in CSS, so the class rule goes first and any existing style after it.
    svg = svg.replace(/<[^>]*\sclass="[\w-]+"[^>]*>/g, (tag) => {
      const c = tag.match(/\sclass="([\w-]+)"/)[1];
      tag = tag.replace(/\sclass="[\w-]+"/, '');
      if (!rules[c]) return tag;
      return /\sstyle="/.test(tag)
        ? tag.replace(/\sstyle="([^"]*)"/, (_, st) => ` style="${rules[c]};${st}"`)
        : tag.replace(/(\/?>)$/, ` style="${rules[c]}"$1`);
    });
  }
  return svg.trim();
}

function parse(svg) {
  const open = svg.match(/<svg\b([^>]*)>/);
  if (!open) throw new Error('no <svg> root');
  const attrs = open[1];
  const inner = svg.slice(open.index + open[0].length, svg.lastIndexOf('</svg>')).trim();
  const attr = (n) => attrs.match(new RegExp(`\\s${n}="([^"]+)"`))?.[1];
  let viewBox = attr('viewBox');
  if (!viewBox) viewBox = `0 0 ${parseFloat(attr('width'))} ${parseFloat(attr('height'))}`;
  return { inner, viewBox, rootFill: attr('fill') };
}

// Prefix every id (and every #id reference) so tiles can share one document.
function namespace(svg, prefix) {
  const ids = [...new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))];
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    svg = svg
      .replace(new RegExp(`\\sid="${esc}"`, 'g'), ` id="${prefix}${id}"`)
      .replace(new RegExp(`#${esc}(?=[)"'\\s])`, 'g'), `#${prefix}${id}`);
  }
  return svg;
}

const rect = `<rect width="${TILE}" height="${TILE}" fill="${BG}" rx="${RX}"/>`;

function logoTile(name) {
  const cfg = LOGOS[name];
  if (!cfg) throw new Error(`no LOGOS config for ${name}`);
  let svg = clean(read('icons', 'logos', `${name}.svg`));
  for (const re of cfg.drop ?? []) svg = svg.replace(re, '');
  for (const [from, to] of Object.entries(cfg.recolor ?? {})) svg = svg.split(from).join(to);
  const { inner, viewBox, rootFill } = parse(svg);
  const [vx, vy, vw, vh] = (cfg.viewBox ?? viewBox).split(/[\s,]+/).map(Number);
  const s = cfg.box / Math.max(vw, vh);
  const tx = (TILE - vw * s) / 2 - vx * s;
  const ty = (TILE - vh * s) / 2 - vy * s + (cfg.dy ?? 0);
  const fill = cfg.fill ?? (rootFill && rootFill !== 'none' ? rootFill : null);
  const g = `<g${fill ? ` fill="${fill}"` : ''} transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(5)})">${inner}</g>`;
  return rect + g;
}

function tile(ref) {
  const [kind, name] = ref.split(':');
  if (kind === 'sk') return parse(clean(read('icons', 'skillicons', `${name}.svg`))).inner;
  if (kind === 'wm') return parse(read('icons', 'wordmarks', `${name}.svg`)).inner;
  if (kind === 'logo') return logoTile(name);
  throw new Error(`unknown tile ref ${ref}`);
}

function row(refs) {
  const width = refs.length * PITCH - (PITCH - TILE);
  const tiles = refs
    .map((ref, i) => `<svg x="${i * PITCH}" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">${namespace(tile(ref), `t${i}_`)}</svg>`)
    .join('\n  ');
  return { width, tiles };
}

function rowSvg(refs) {
  const { width, tiles } = row(refs);
  const w = ((width * OUT_H) / TILE).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${OUT_H}" viewBox="0 0 ${width} ${TILE}" fill="none">\n  ${tiles}\n</svg>\n`;
}

mkdirSync(join(ROOT, 'assets'), { recursive: true });
for (const [name, refs] of Object.entries(ROWS)) {
  const out = `stack-${name}.svg`;
  const svg = rowSvg(refs);
  writeFileSync(join(ROOT, 'assets', out), svg);
  console.log(`${out.padEnd(22)} ${refs.length} tiles  ${(svg.length / 1024).toFixed(1)} kB`);
}

const previewIdx = process.argv.indexOf('--preview');
if (previewIdx > 0) {
  let y = 0, parts = [], maxW = 0;
  for (const [name, refs] of Object.entries(ROWS)) {
    const { width, tiles } = row(refs);
    maxW = Math.max(maxW, width);
    parts.push(`<text x="0" y="${y + 150}" font-family="sans-serif" font-size="60" fill="#888">${name}</text><g transform="translate(400 ${y})">${namespace(tiles, `r${parts.length}_`)}</g>`);
    y += TILE + 80;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${maxW + 400} ${y}" width="${(maxW + 400) / 2}" height="${y / 2}"><rect width="100%" height="100%" fill="#0d1117"/>${parts.join('')}</svg>`;
  writeFileSync(process.argv[previewIdx + 1], svg);
}
