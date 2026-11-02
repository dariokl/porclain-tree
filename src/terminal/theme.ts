export type SidebarTheme = Readonly<{
  background: string; text: string; muted: string; border: string;
  accent: string; added: string; modified: string; deleted: string; warning: string;
}>;

const dark: SidebarTheme = {
  background: "#141615", text: "#dadbd5", muted: "#9a9d95", border: "#363d36",
  accent: "#9db3b7", added: "#a3c6a7", modified: "#d1b67d", deleted: "#d59b8f", warning: "#d1b67d",
};
const light: SidebarTheme = {
  background: "#f1f1ed", text: "#303530", muted: "#686e64", border: "#d6d9d2",
  accent: "#4b6568", added: "#3f704f", modified: "#87682e", deleted: "#a75243", warning: "#87682e",
};

export function sidebarTheme(mode: "light" | "dark" | null): SidebarTheme {
  return mode === "light" ? light : dark;
}
