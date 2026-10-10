import type { ClientModule } from 'claude-code'

// One pane control on the desktop. The desktop resolves a Pane Button's press by a handle
// that every redraw replaces, so those presses never land; a Client's post is addressed by
// its key, which the hooks module reads as the control pressed.
export type ControlProps = { label: string; dim?: boolean; hover?: string }
type Local = { isHover: boolean }

const Control: ClientModule<ControlProps, Local> = (props, surface) => {
  const { Text } = surface.elements
  const isHover = surface.state?.isHover ?? false
  surface.onPointer(e => {
    if (e.type === 'down' && (e.button ?? 'left') === 'left') surface.post({ press: true })
    const isOver = e.type !== 'leave'
    if (props.hover && isOver !== (surface.state?.isHover ?? false)) surface.setState({ isHover: isOver })
  })
  const isLit = isHover && !!props.hover
  return (
    <Text color={isLit ? props.hover : undefined} dimColor={props.dim && !isLit ? true : undefined}>
      {props.label}
    </Text>
  )
}

export default Control
