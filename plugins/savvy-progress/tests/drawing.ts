// The surface module a looping desktop drawing goes through, as the drawn tree names it.
export const MARK = 'hooks/mark.tsx'

// A drawing's image props: an Svg's own, or a mark Client's (mark.tsx draws its props as an Svg).
export const imgOf = <P>(n?: { type: string; props?: P & { module?: string; props?: P } }): P | undefined =>
  n?.type === 'Svg' ? n.props : n?.props?.module === MARK ? n.props.props : undefined
