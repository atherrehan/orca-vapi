// Tiny DOM helpers. Text is only ever set with textContent, never innerHTML, so nothing from
// Vapi can inject markup into the panel.
export type Child = Node | string | null | undefined | false

export type Props = {
  className?: string
  text?: string
  attrs?: Record<string, string>
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.className) node.className = props.className
  if (props.text !== undefined) node.textContent = props.text
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value)
  for (const [name, handler] of Object.entries(props.on ?? {})) {
    node.addEventListener(name, handler as EventListener)
  }
  for (const child of children) if (child) node.append(child)
  return node
}

export function button(
  text: string,
  onClick: (event: MouseEvent) => void,
  className = 'btn'
): HTMLButtonElement {
  return el('button', { className, text, attrs: { type: 'button' }, on: { click: onClick } })
}

export function header(): HTMLElement {
  return el('header', {}, [
    el('h1', { text: 'Vapi Orca' }),
    el('p', { className: 'disclaimer', text: 'Unofficial. Not affiliated with or endorsed by Vapi.' })
  ])
}

export function footer(version: string): HTMLElement {
  return el('footer', { text: `v${version} · read-only` })
}

/** Opens a link in the person's browser through Orca, which asks before a new host. */
export async function openExternal(url: string): Promise<void> {
  if (orca.shell) await orca.shell.openExternal(url)
}
