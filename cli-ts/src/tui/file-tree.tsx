import { readdir } from "node:fs/promises";
import path from "node:path";
import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

export interface FileTreeNode {
	id: string;
	name: string;
	fullPath: string;
	isDirectory: boolean;
	indent: number;
	children: FileTreeNode[];
}

export interface FileTreeRow {
	id: string;
	name: string;
	fullPath: string;
	isDirectory: boolean;
	indent: number;
}

export interface FileTreeProps {
	cwd: string;
	onSelect: (filePath: string, isDirectory: boolean) => void;
	initialSelectedId?: string;
	initialExpandedIds?: string[];
}

const IGNORED_NAMES = new Set([".git", "node_modules"]);

export async function buildFileTree(cwd: string): Promise<FileTreeNode[]> {
	const entries = await readdir(cwd, { withFileTypes: true });
	const visible = entries.filter((entry) => !IGNORED_NAMES.has(entry.name));

	const nodes = await Promise.all(
		visible.map(async (entry) => {
			const fullPath = path.join(cwd, entry.name);
			const node: FileTreeNode = {
				id: fullPath,
				name: entry.name,
				fullPath,
				isDirectory: entry.isDirectory(),
				indent: 0,
				children: [],
			};

			if (node.isDirectory) {
				node.children = await buildFileTree(fullPath);
				for (const child of node.children) {
					child.indent = node.indent + 1;
				}
			}

			return node;
		}),
	);

	nodes.sort((a, b) => {
		if (a.isDirectory === b.isDirectory) {
			return a.name.localeCompare(b.name);
		}
		return a.isDirectory ? -1 : 1;
	});

	return nodes;
}

function flattenNodes(
	nodes: FileTreeNode[],
	expanded: ReadonlySet<string>,
	rows: FileTreeRow[] = [],
): FileTreeRow[] {
	for (const node of nodes) {
		rows.push({
			id: node.id,
			name: node.name,
			fullPath: node.fullPath,
			isDirectory: node.isDirectory,
			indent: node.indent,
		});
		if (node.isDirectory && expanded.has(node.id)) {
			flattenNodes(node.children, expanded, rows);
		}
	}
	return rows;
}

export function FileTree({
	cwd,
	onSelect,
	initialSelectedId,
	initialExpandedIds,
}: FileTreeProps): ReactElement {
	const [nodes, setNodes] = useState<FileTreeNode[]>([]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set(initialExpandedIds ?? []));
	const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId);

	useEffect(() => {
		let cancelled = false;
		buildFileTree(cwd)
			.then((tree) => {
				if (!cancelled) {
					setNodes(tree);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setNodes([]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	const rows = useMemo(() => flattenNodes(nodes, expanded), [nodes, expanded]);

	useEffect(() => {
		if (rows.length === 0) {
			setSelectedId(undefined);
			return;
		}
		if (selectedId === undefined || !rows.some((row) => row.id === selectedId)) {
			setSelectedId(rows[0]?.id);
		}
	}, [rows, selectedId]);

	const selectedIndex = useMemo(() => {
		return rows.findIndex((row) => row.id === selectedId);
	}, [rows, selectedId]);

	function moveSelection(delta: number): void {
		if (rows.length === 0) {
			return;
		}
		const current = selectedIndex >= 0 ? selectedIndex : 0;
		const next = Math.max(0, Math.min(rows.length - 1, current + delta));
		setSelectedId(rows[next]?.id);
	}

	function toggleExpanded(row: FileTreeRow): void {
		if (!row.isDirectory) {
			return;
		}
		setExpanded((previous) => {
			const next = new Set(previous);
			if (next.has(row.id)) {
				next.delete(row.id);
			} else {
				next.add(row.id);
			}
			return next;
		});
	}

	useInput((input, key) => {
		if (key.upArrow) {
			moveSelection(-1);
			return;
		}
		if (key.downArrow) {
			moveSelection(1);
			return;
		}
		if (key.rightArrow) {
			const row = rows[selectedIndex];
			if (row?.isDirectory) {
				setExpanded((previous) => new Set(previous).add(row.id));
			}
			return;
		}
		if (key.leftArrow) {
			const row = rows[selectedIndex];
			if (row?.isDirectory) {
				setExpanded((previous) => {
					const next = new Set(previous);
					next.delete(row.id);
					return next;
				});
			}
			return;
		}
		if (key.return) {
			const row = rows[selectedIndex];
			if (row) {
				onSelect(row.fullPath, row.isDirectory);
			}
			return;
		}
		if (input === " ") {
			const row = rows[selectedIndex];
			if (row?.isDirectory) {
				toggleExpanded(row);
			}
		}
	});

	return (
		<Box flexDirection="column" flexGrow={1} overflow="hidden">
			{rows.map((row) => {
				const isSelected = row.id === selectedId;
				const prefix = "  ".repeat(row.indent);
				const icon = row.isDirectory ? (expanded.has(row.id) ? "📂" : "📁") : "📄";
				return (
					<Box key={row.id} flexDirection="row" height={1}>
						<Text>
							{prefix}
							{isSelected ? "> " : "  "}
						</Text>
						<Text
							backgroundColor={isSelected ? "cyan" : undefined}
							color={isSelected ? "black" : undefined}
						>
							{icon} {row.name}
						</Text>
					</Box>
				);
			})}
		</Box>
	);
}
