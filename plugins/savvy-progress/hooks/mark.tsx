import type { ClientModule, RenderElement } from 'claude-code'

// A running card's platter on the desktop. The desktop rebuilds a pane's images on every redraw,
// so an animated image starts over; a Client under one key is kept and draws again only on new
// props. The props are the platter's constant drawing, so its image runs on. The element table
// has no Svg, but the desktop draws one a module returns.
export type MarkProps = { source: string; alt: string; width: number; height: number; isInteractive: boolean }

const Mark: ClientModule<MarkProps> = props => h('Svg', props) as RenderElement

export default Mark
