/**
 * Browser half of dsh-terminal-ui.
 *
 * Registers two slot entries:
 *   - a "Terminal" button in `conversation.session.header.actions` that opens
 *     the details column and spawns the first session,
 *   - the tabbed terminal panel itself as the `details` slot occupant.
 *
 * Sitting in the `details` slot makes the terminal a real layout track (the
 * right column) rather than a floating overlay, so it pushes the conversation
 * content instead of covering it. Column open/close is owned by `ctx.layout`;
 * tab state lives in the module-local `terminalStore`.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { TerminalHeaderAction, type TerminalHeaderActionInjected } from './TerminalHeaderAction.tsx'
import { TerminalPanel, type TerminalPanelInjected } from './TerminalPanel.tsx'
import './xterm.css'
import './styles.css'

/** Required services: the slot registry and the panel-geometry controller. */
export const inject = ['slots', 'layout']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'terminal',
    order: 30,
    inject: (): TerminalHeaderActionInjected => ({
      openDetails: () => { ctx.layout.openDetails() },
    }),
  }, TerminalHeaderAction))

  // `details` is a single-occupant slot already held by ui-conversation's
  // DetailsPanel at priority 0; registering at a lower priority shadows it so
  // this terminal panel is what renders in the right column.
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -1,
    inject: (): TerminalPanelInjected => ({
      closeDetails: () => { ctx.layout.closeDetails() },
    }),
  }, TerminalPanel))
}
