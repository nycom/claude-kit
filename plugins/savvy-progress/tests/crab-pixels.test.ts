import { expect, test } from 'claude-code/testing'

import { COSTUMES, crab } from '../hooks/register'

// The crab used to be one <rect> per pixel; it is one <path> per colour per group now. The old
// builder stays here, so every costume in every pose can be checked to cover the same pixels.
type Fill = Parameters<NonNullable<(typeof COSTUMES)[string]>>[0]
const rectCrab = (x: number, y: number, costume: string, dim: boolean, isWalking: boolean, scale: number, tint: string): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  COSTUMES[costume]?.(f, tint)
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

// A drawing as its group tags in order, and each group's pixels: the colours that show on each
// cell, bottom to top, from the topmost opaque one. A group moves and fades as one, so its
// pixels are what it draws.
const visible = (paints: string[]): string[] => paints.slice(Math.max(0, paints.findLastIndex(c => !c.startsWith('rgba('))))
const raster = (svg: string) => {
  const tags: string[] = []
  const stack: string[] = []
  const cells = new Map<string, string[]>()
  const paint = (x: number, y: number, w: number, h: number, c: string) => {
    for (let py = y; py < y + h; py++)
      for (let px = x; px < x + w; px++) {
        const k = `${stack.join('/')}@${px},${py}`
        cells.set(k, [...(cells.get(k) ?? []), c])
      }
  }
  for (const [tag] of svg.matchAll(/<[^>]+>/g)) {
    const rect = /^<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="([^"]+)"\/>$/.exec(tag)
    const path = /^<path d="([^"]+)" fill="([^"]+)"\/>$/.exec(tag)
    if (rect) paint(Number(rect[1]), Number(rect[2]), Number(rect[3]), Number(rect[4]), rect[5] ?? '')
    else if (path) {
      const d = path[1] ?? ''
      const rects = [...d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z/g)]
      expect(rects.map(m => m[0]).join('')).toBe(d)
      for (const m of rects) {
        expect(m[5]).toBe(m[3])
        paint(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), path[2] ?? '')
      }
    } else {
      tags.push(tag)
      if (tag === '</g>') stack.pop()
      else stack.push(tag)
    }
  }
  expect(stack).toEqual([])
  return { tags, cells: Object.fromEntries([...cells].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, paints]) => [k, visible(paints)])) }
}

test('crab pixels: every costume, walking or still, dim or not, at either scale, paints the same cells as the one-rect-per-pixel crab', () => {
  const costumes = Object.keys(COSTUMES)
  expect(costumes.length).toBeGreaterThan(10)
  for (const costume of costumes)
    for (const isWalking of [false, true])
      for (const dim of [false, true])
        for (const [x, y, scale] of [[0, 14, 1.1], [1, 3.4, 0.8]] as const) {
          const was = rectCrab(x, y, costume, dim, isWalking, scale, '#378ADD')
          const now = crab(x, y, costume, dim, isWalking, scale, '#378ADD')
          expect(raster(now)).toEqual(raster(was))
          expect(now.length).toBeLessThan(was.length)
        }
})
