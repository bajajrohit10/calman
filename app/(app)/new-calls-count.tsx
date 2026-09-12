"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/**
 * One New Calls number for the whole shell (§29.1 follow-up).
 *
 * The pill polls and the sidebar badge is server-rendered, so until now they
 * only agreed immediately after a navigation: a minute later the pill said 7
 * and the rail still said 5. That was survivable while the badge was a quiet
 * number in a rail. It is not survivable now that both blink together as one
 * alert — two things flashing in step and disagreeing about the count read as
 * a broken screen, not an urgent one.
 *
 * So the poll publishes here and the badge prefers it, falling back to the
 * server's number until the first tick. The pill keeps the polling because
 * that is where the count is actually used; this is a place to put it, not a
 * second copy of it.
 */
type NewCallsState = {
  /** null until the first poll: the badge should show the server's figure. */
  count: number | null;
  /** How many arrived on the last tick, for the six-second flash. */
  added: number;
};

const Ctx = createContext<{
  state: NewCallsState;
  publish: Dispatch<SetStateAction<NewCallsState>>;
}>({ state: { count: null, added: 0 }, publish: () => {} });

export function NewCallsCountProvider({ children }: { children: ReactNode }) {
  const [state, publish] = useState<NewCallsState>({ count: null, added: 0 });
  const value = useMemo(() => ({ state, publish }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNewCallsCount() {
  return useContext(Ctx).state;
}

export function usePublishNewCallsCount() {
  return useContext(Ctx).publish;
}
