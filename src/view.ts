import { resolveView, viewParam, type View } from '@chrischall/mcp-utils';

/**
 * The rungs this server honours (`@chrischall/mcp-utils`' `view` vocabulary;
 * `chrischall/workflows` `docs/fleet-conventions.md`, "Response shape").
 *
 * A GROUNDED repo: it already had a field projection, and it was opt-in —
 * `compact: false`, so the caller had to know the slim rung existed and ask
 * for it. An efficiency that has to be requested is one that usually is not,
 * and the caller paying for it is the one least able to know.
 *
 * `compact` is the default now.
 *
 * There is deliberately no media-stripping rung here, and no `viewResponse`
 * helper to apply one. Nothing this server returns is an upstream payload:
 * `AccessoOrder`/`AccessoTicket` are parsed out of the merchant's HTML into
 * our own types, and every other tool builds its result object in code. So the
 * only shape `view` can act on is `presentOrder`'s hand-written projection —
 * which must NOT then be media-stripped, because its field choices were made
 * WITH knowledge of the page, and running a blind subtractive rule over its
 * output would let an un-grounded rule overrule a grounded one (that bit
 * viator-mcp, where the projection deliberately keeps a cover image). A
 * stripping helper wired in here would be a `view` value that changes nothing.
 *
 * No `raw` rung: `full` already returns every field we parsed.
 */
export const ACC_VIEWS = ['compact', 'full'] as const;

const NOTE =
  'compact returns the slim per-ticket projection — identity, participant, date, time; ' +
  '"full" returns every field parsed from the order page.';

/** The `view` parameter every read tool in this server takes. */
export const viewArg = (): ReturnType<typeof viewParam> => viewParam(ACC_VIEWS, { note: NOTE });

/** Is this call asking for the slim rung? Replaces the old `compact` boolean. */
export function isCompact(view: string | undefined): boolean {
  const rung: View = resolveView(view, ACC_VIEWS);
  return rung === 'compact';
}
