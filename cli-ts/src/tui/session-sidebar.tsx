import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { MemoryManager, Session } from "../memory/manager.js";

export interface SessionSidebarProps {
	sessionId?: string;
	onSelectSession?: (sessionId: string) => void;
	onCreateSession?: () => void;
	memoryManager?: MemoryManager;
}

export function SessionSidebar({
	sessionId,
	onSelectSession,
	onCreateSession,
	memoryManager,
}: SessionSidebarProps): ReactElement {
	const [sessions, setSessions] = useState<Session[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);

	useEffect(() => {
		if (memoryManager === undefined) {
			setSessions([]);
			setSelectedIndex(0);
			return;
		}
		const loaded = memoryManager
			.listSessions()
			.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
		setSessions(loaded);
		const activeIndex = loaded.findIndex((session) => session.id === sessionId);
		setSelectedIndex(activeIndex >= 0 ? activeIndex : 0);
	}, [memoryManager, sessionId]);

	useInput((input, key) => {
		if (key.ctrl && input === "n") {
			onCreateSession?.();
			return;
		}
		if (onSelectSession === undefined || sessions.length === 0) {
			return;
		}
		if (key.upArrow) {
			setSelectedIndex((previous) => Math.max(0, previous - 1));
			return;
		}
		if (key.downArrow) {
			setSelectedIndex((previous) => Math.min(sessions.length - 1, previous + 1));
			return;
		}
		if (key.return) {
			const session = sessions[selectedIndex];
			if (session !== undefined) {
				onSelectSession(session.id);
			}
		}
	});

	if (sessions.length === 0) {
		return (
			<Box flexGrow={1} alignItems="center" justifyContent="center">
				<Text dimColor>No sessions yet</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" flexGrow={1} overflow="hidden">
			{sessions.map((session, index) => {
				const isActive = session.id === sessionId;
				const isSelected = index === selectedIndex;
				const messageCount = memoryManager?.getMessages(session.id).length ?? 0;
				const label = `${session.title} (${messageCount})`;
				return (
					<Box key={session.id} flexDirection="row" height={1}>
						<Text
							backgroundColor={isSelected ? "cyan" : undefined}
							color={isSelected ? "black" : isActive ? "blue" : undefined}
							bold={isActive}
						>
							{isSelected ? "> " : "  "}
							{label}
						</Text>
					</Box>
				);
			})}
		</Box>
	);
}
