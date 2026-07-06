import { Box, Spacer, Text } from "ink";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { MemoryManager } from "../memory/manager.js";
import { ChatPanel } from "./chat-panel.js";
import { DiffPanel } from "./diff-panel.js";
import { FileTree } from "./file-tree.js";
import { SessionSidebar } from "./session-sidebar.js";
import { StatusBar } from "./status-bar.js";

export interface AppProps {
	cwd?: string;
}

export default function App({ cwd = process.cwd() }: AppProps): ReactElement {
	const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
	const [diffContent, setDiffContent] = useState<string | undefined>(undefined);
	const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
	const memoryManager = useMemo(() => new MemoryManager(), []);

	const handleSelect = (filePath: string, isDirectory: boolean): void => {
		if (isDirectory) {
			return;
		}
		setSelectedPath(filePath);
		setDiffContent(undefined);
	};

	const handleShowDiff = (diff: string): void => {
		setDiffContent(diff);
	};

	return (
		<Box flexDirection="column" width="100%" height="100%">
			{/* Top status bar */}
			<StatusBar provider="auto" model="default" agent="ask" tool="-" />

			{/* Main body */}
			<Box flexDirection="row" flexGrow={1}>
				{/* Left: file tree and session summary */}
				<Box width="30%" flexDirection="column">
					<Box
						flexGrow={3}
						flexDirection="column"
						borderStyle="round"
						borderColor="yellow"
						paddingX={1}
					>
						<Text color="yellow" bold>
							Files
						</Text>
						<FileTree cwd={cwd} onSelect={handleSelect} />
					</Box>

					<Box
						flexGrow={1}
						flexDirection="column"
						borderStyle="round"
						borderColor="blue"
						paddingX={1}
					>
						<Text color="blue" bold>
							Session
						</Text>
						<SessionSidebar
							sessionId={activeSessionId}
							onSelectSession={setActiveSessionId}
							onCreateSession={() => setActiveSessionId(undefined)}
							memoryManager={memoryManager}
						/>
					</Box>
				</Box>

				{/* Right: diff viewer and chat */}
				<Box width="70%" flexDirection="column">
					<Box
						flexGrow={3}
						flexDirection="column"
						borderStyle="round"
						borderColor="magenta"
						paddingX={1}
					>
						<DiffPanel filePath={selectedPath} diff={diffContent} />
					</Box>

					<Box
						flexGrow={2}
						flexDirection="column"
						borderStyle="round"
						borderColor="green"
						paddingX={1}
					>
						<ChatPanel
							onShowDiff={handleShowDiff}
							onSessionId={setActiveSessionId}
							sessionId={activeSessionId}
							memoryManager={memoryManager}
						/>
					</Box>
				</Box>
			</Box>
		</Box>
	);
}
