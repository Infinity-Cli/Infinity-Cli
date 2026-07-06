import { readFile } from "node:fs/promises";
import { Box, Text, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { execGitDiff } from "./git-diff.js";

export interface DiffPanelProps {
	filePath?: string;
	diff?: string;
	gitDiffForPath?: string;
	title?: string;
	showLineNumbers?: boolean;
	height?: number;
}

async function loadGitDiff(filePath: string): Promise<string> {
	return execGitDiff(filePath);
}

export interface ColorizedLine {
	line: string;
	color?: string;
}

export function colorizeDiff(diff: string): ColorizedLine[] {
	return diff.split("\n").map((line) => {
		let color: string | undefined;
		if (line.startsWith("@@")) {
			color = "yellow";
		} else if (line.startsWith("+")) {
			color = "green";
		} else if (line.startsWith("-")) {
			color = "red";
		} else {
			color = "white";
		}
		return { line, color };
	});
}

export function DiffPanel({
	filePath,
	diff,
	gitDiffForPath,
	title,
	showLineNumbers = false,
	height,
}: DiffPanelProps): ReactElement {
	const { stdout } = useStdout();
	const panelHeight = height ?? Math.max(8, stdout.rows - 6);
	const [fileContent, setFileContent] = useState<string | undefined>(undefined);
	const [gitDiffContent, setGitDiffContent] = useState<string | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		if (filePath !== undefined && diff === undefined) {
			readFile(filePath, "utf-8")
				.then((content) => {
					if (!cancelled) {
						setFileContent(content);
					}
				})
				.catch((err: unknown) => {
					if (!cancelled) {
						setFileContent(
							`Error reading file: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				});
		} else {
			setFileContent(undefined);
		}

		if (gitDiffForPath !== undefined && diff === undefined && filePath === undefined) {
			loadGitDiff(gitDiffForPath)
				.then((gitDiff) => {
					if (!cancelled) {
						setGitDiffContent(gitDiff);
					}
				})
				.catch((err: unknown) => {
					if (!cancelled) {
						setGitDiffContent(
							`Error loading git diff: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				});
		} else {
			setGitDiffContent(undefined);
		}
		return () => {
			cancelled = true;
		};
	}, [filePath, diff, gitDiffForPath]);

	const lines = useMemo<ColorizedLine[]>(() => {
		if (diff !== undefined) {
			return colorizeDiff(diff);
		}
		if (gitDiffContent !== undefined) {
			return colorizeDiff(gitDiffContent);
		}
		if (fileContent !== undefined) {
			return fileContent.split("\n").map((line) => ({ line, color: "white" }));
		}
		return [{ line: "No content", color: "gray" }];
	}, [diff, gitDiffContent, fileContent]);

	const [offset, setOffset] = useState(0);
	const maxOffset = Math.max(0, lines.length - panelHeight);

	useEffect(() => {
		setOffset((previous) => Math.min(previous, maxOffset));
	}, [maxOffset]);

	useInput((_input, key) => {
		if (key.upArrow) {
			setOffset((previous) => Math.max(0, previous - 1));
		} else if (key.downArrow) {
			setOffset((previous) => Math.min(maxOffset, previous + 1));
		} else if (key.pageUp) {
			setOffset((previous) => Math.max(0, previous - panelHeight));
		} else if (key.pageDown) {
			setOffset((previous) => Math.min(maxOffset, previous + panelHeight));
		}
	});

	const visibleLines = lines.slice(offset, offset + panelHeight);

	const header =
		title ??
		(filePath !== undefined
			? `File: ${filePath}`
			: gitDiffForPath !== undefined
				? `Git diff: ${gitDiffForPath}`
				: diff !== undefined
					? "Diff"
					: "Diff Viewer");

	return (
		<Box flexDirection="column" flexGrow={1} overflow="hidden">
			<Box height={1} flexDirection="row">
				<Text bold>{header}</Text>
			</Box>
			<Box flexDirection="column" flexGrow={1} overflow="hidden">
				{visibleLines.map((item, index) => {
					const lineNumber = showLineNumbers ? offset + index + 1 : undefined;
					const prefix = lineNumber !== undefined ? `${String(lineNumber).padStart(4, " ")} ` : "";
					const lineKey = `${offset + index}-${item.line}`;
					return (
						<Box key={lineKey} flexDirection="row">
							<Text color={item.color} wrap="wrap">
								{prefix}
								{item.line}
							</Text>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
