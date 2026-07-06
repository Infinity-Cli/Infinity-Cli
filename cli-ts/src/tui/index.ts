import { Command } from "commander";
import { renderTUI } from "./render.js";

export { renderTUI } from "./render.js";
export { FileTree, buildFileTree } from "./file-tree.js";
export type { FileTreeProps, FileTreeNode, FileTreeRow } from "./file-tree.js";
export { DiffPanel, colorizeDiff } from "./diff-panel.js";
export type { DiffPanelProps, ColorizedLine } from "./diff-panel.js";
export { SessionSidebar } from "./session-sidebar.js";
export type { SessionSidebarProps } from "./session-sidebar.js";
export { StatusBar } from "./status-bar.js";
export type { StatusBarProps } from "./status-bar.js";
export { execGitDiff } from "./git-diff.js";

export function tuiCommand(): Command {
	return new Command("tui").description("Start the OpenCode-style terminal UI").action(async () => {
		await renderTUI();
	});
}
