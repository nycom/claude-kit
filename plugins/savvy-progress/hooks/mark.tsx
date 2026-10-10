import type { ClientModule, RenderElement } from 'claude-code'

// A looping drawing on the desktop: a crab, a platter, the band's twinkle. The desktop rebuilds
// a surface's images on every redraw, so an animated image starts over; a Client under one key
// is kept and draws again only on new props. The props are the drawing's constant source, so its
// image runs on. The element table has no Svg, but the desktop draws one a module returns.
export type MarkProps = { source: string; alt: string; width: number; height: number }

const Mark: ClientModule<MarkProps> = props => h('Svg', props) as RenderElement

export default Mark
