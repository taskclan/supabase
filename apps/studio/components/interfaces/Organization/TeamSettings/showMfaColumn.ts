/**
 * Whether the Team table shows an MFA column.
 *
 * Taskclan Cloud does not track multi-factor status. It lives in the Supabase
 * auth project, reachable only with a service role key that this console
 * deliberately does not hold, so there is no honest value to render.
 *
 * The cell upstream draws is a hard binary with no unknown state: anything that
 * is not `mfa_enabled` renders as "Disabled" with a cross. Sending false would
 * therefore assert, on every row, that a person has MFA switched off. That is a
 * claim about a security control, and an org admin scanning this column for
 * people to chase would be reading an answer nobody computed.
 *
 * Hiding the column says "this console cannot tell you", which is true, and is
 * the same choice made for project-scoped roles.
 *
 * Exported as one constant because the header and the cell live in different
 * components; deriving it twice is how a table ends up with a column heading
 * over the wrong data.
 */
import { IS_PLATFORM } from '@/lib/constants'

export const SHOWS_MFA_COLUMN = IS_PLATFORM
