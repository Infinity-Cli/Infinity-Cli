import { Box, Text } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { askOnce } from "../ask-engine.js";
import { MemoryManager } from "../memory/manager.js";
import { InputBox } from "./input-box.js";

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	error?: boolean;
}

export interface ChatPanelProps {
	onAsk?: (prompt: string) => Promise<string>;
	onShowDiff?: (diff: string) => void;
	onSessionId?: (sessionId: string) => void;
	sessionId?: string;
	memoryManager?: MemoryManager;
}

async function defaultAsk(prompt: string): Promise<string> {
	const { response } = await askOnce(prompt, {});
	return response;
}

export function extractDiffBlocks(text: string): string[] {
	const blocks: string[] = [];
	const lines = text.split("\n");
	let insideDiff = false;
	let current: string[] = [];

	for (const line of lines) {
		if (line.trim().toLowerCase().startsWith("```diff")) {
			insideDiff = true;
			current = [];
			continue;
		}
		if (insideDiff && line.trim() === "```") {
			insideDiff = false;
			blocks.push(current.join("\n"));
			current = [];
			continue;
		}
		if (insideDiff) {
			current.push(line);
		}
	}

	return blocks;
}

export function ChatPanel({
	onAsk,
	onShowDiff,
	onSessionId,
	sessionId,
	memoryManager: memoryManagerProp,
}: ChatPanelProps): ReactElement {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const fallbackManagerRef = useRef<MemoryManager | undefined>(undefined);
	let fallbackManager = fallbackManagerRef.current;
	if (fallbackManager === undefined) {
		fallbackManager = new MemoryManager();
		fallbackManagerRef.current = fallbackManager;
	}
	const memoryManager = memoryManagerProp ?? fallbackManager;

	useEffect(() => {
		if (onShowDiff === undefined) {
			return;
		}
		for (const message of messages) {
			if (message.role !== "assistant") {
				continue;
			}
			const blocks = extractDiffBlocks(message.content);
			if (blocks.length > 0) {
				onShowDiff(blocks[0] ?? "");
				return;
			}
		}
	}, [messages, onShowDiff]);

	useEffect(() => {
		if (memoryManager === undefined) {
			return;
		}
		if (sessionId === undefined) {
			setMessages([]);
			return;
		}
		const loaded = memoryManager.getMessages(sessionId);
		setMessages(
			loaded
				.filter((message) => message.role === "user" || message.role === "assistant")
				.map((message) => ({
					id: message.id,
					role: message.role as "user" | "assistant",
					content: message.content,
				})),
		);
	}, [sessionId, memoryManager]);

	const handleInputChange = (value: string): void => {
		setInput(value);
	};

	const handleSend = async (): Promise<void> => {
		const trimmed = input.trim();
		if (trimmed.length === 0) {
			return;
		}

		let currentSessionId = sessionId;
		if (onSessionId !== undefined && currentSessionId === undefined) {
			const session = memoryManager.createSession(trimmed.slice(0, 80));
			currentSessionId = session.id;
			onSessionId(currentSessionId);
		}
		if (currentSessionId !== undefined) {
			memoryManager.addMessage(currentSessionId, "user", trimmed);
		}

		setMessages((previous) => [
			...previous,
			{ id: `user-${previous.length}`, role: "user", content: trimmed },
		]);
		setInput("");
		setIsLoading(true);
		setError(undefined);

		try {
			const response = await (onAsk ?? defaultAsk)(trimmed);
			if (currentSessionId !== undefined) {
				memoryManager.addMessage(currentSessionId, "assistant", response);
			}
			setMessages((previous) => [
				...previous,
				{ id: `assistant-${previous.length}`, role: "assistant", content: response },
			]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Box width="70%" flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
			<Text color="green" bold>
				Chat
			</Text>

			<Box flexGrow={1} flexDirection="column" overflow="hidden">
				{messages.map((message) =>
					message.role === "user" ? (
						<Box key={message.id} flexDirection="row">
							<Text color="green">{"> "}</Text>
							<Text>{message.content}</Text>
						</Box>
					) : (
						<Box key={message.id} flexDirection="row">
							<Text color="cyan">{"< "}</Text>
							<Text color={message.error ? "red" : undefined}>{message.content}</Text>
						</Box>
					),
				)}
				{isLoading && (
					<Box flexDirection="row">
						<Text color="cyan">{"< "}</Text>
						<Text dimColor>Thinking...</Text>
					</Box>
				)}
				{error && (
					<Box flexDirection="row">
						<Text color="cyan">{"< "}</Text>
						<Text color="red">{error}</Text>
					</Box>
				)}
			</Box>

			<Box flexDirection="row" height={1}>
				<Text bold>{">>> "}</Text>
				<InputBox
					value={input}
					onChange={handleInputChange}
					onSubmit={handleSend}
					placeholder="Type a message and press Enter"
					history={messages
						.filter((message) => message.role === "user")
						.map((message) => message.content)}
				/>
			</Box>
		</Box>
	);
}
