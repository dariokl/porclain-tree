export type SidebarState = Readonly<{
  visible: boolean;
  lastToggleAt: number | null;
}>;

type SidebarAction = Readonly<{ type: "toggle"; at: number }> | Readonly<{ type: "input" }>;

export function sidebarColumns(columns: number, visible: boolean): number {
  return visible && columns >= 100 ? 28 : 0;
}

export function reduceSidebar(
  state: SidebarState,
  action: SidebarAction,
): Readonly<{ state: SidebarState; sendControlG: boolean }> {
  if (action.type === "input") {
    return { state: { ...state, lastToggleAt: null }, sendControlG: false };
  }
  const doubleToggle = state.lastToggleAt !== null
    && action.at - state.lastToggleAt <= 300;
  return {
    state: { visible: !state.visible, lastToggleAt: doubleToggle ? null : action.at },
    sendControlG: doubleToggle,
  };
}
