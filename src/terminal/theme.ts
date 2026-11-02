export type SidebarTheme = Readonly<{
  background: string; text: string; muted: string; border: string;
  accent: string; added: string; modified: string; deleted: string; warning: string;
}>;

const dark: SidebarTheme = {
  background: "#000000", text: "#e5e5e5", muted: "#a3a3a3", border: "#404040",
  accent: "#bdbdbd", added: "#8fb99b", modified: "#c9ae76", deleted: "#cc9292", warning: "#c9ae76",
};
const light: SidebarTheme = {
  background: "#ffffff", text: "#262626", muted: "#666666", border: "#d4d4d4",
  accent: "#4a4a4a", added: "#356b4b", modified: "#806321", deleted: "#9c4646", warning: "#806321",
};

export function sidebarTheme(mode: "light" | "dark"): SidebarTheme {
  return mode === "light" ? light : dark;
}
