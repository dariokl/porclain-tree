export type SidebarTheme = Readonly<{
  background: string;
  activeBackground: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  added: string;
  modified: string;
  deleted: string;
  warning: string;
  addedBackground: string;
  deletedBackground: string;
  syntax: Readonly<Record<string, string>>;
}>;

const dark: SidebarTheme = {
  background: "#000000",
  activeBackground: "#1c1c1c",
  text: "#e5e5e5",
  muted: "#a3a3a3",
  border: "#404040",
  accent: "#bdbdbd",
  added: "#8fb99b",
  modified: "#c9ae76",
  deleted: "#cc9292",
  warning: "#c9ae76",
  addedBackground: "#14251a",
  deletedBackground: "#2b1919",
  syntax: { keyword: "#c5a5cf", string: "#a8c49b", comment: "#929292", number: "#d4b58a", function: "#9dbdd1", type: "#b2c9c5", operator: "#c4c4c4", punctuation: "#b0b0b0", variable: "#e5e5e5", constant: "#d4b58a", property: "#b2c9c5", tag: "#9dbdd1", attribute: "#d4b58a" },
};
const light: SidebarTheme = {
  background: "#ffffff",
  activeBackground: "#ededed",
  text: "#262626",
  muted: "#666666",
  border: "#d4d4d4",
  accent: "#4a4a4a",
  added: "#356b4b",
  modified: "#806321",
  deleted: "#9c4646",
  warning: "#806321",
  addedBackground: "#e8f2e9",
  deletedBackground: "#f8e9e9",
  syntax: { keyword: "#754082", string: "#3f6637", comment: "#6b6b6b", number: "#87591e", function: "#315f80", type: "#326761", operator: "#474747", punctuation: "#555555", variable: "#262626", constant: "#87591e", property: "#326761", tag: "#315f80", attribute: "#87591e" },
};

export function sidebarTheme(mode: "light" | "dark"): SidebarTheme {
  return mode === "light" ? light : dark;
}
