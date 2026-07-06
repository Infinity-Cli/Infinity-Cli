import { Box, Spacer, Text, useStdout } from "ink";
import type { ReactElement } from "react";

export interface StatusBarProps {
	provider?: string;
	model?: string;
	agent?: string;
	tool?: string;
}

function truncateCenter(text: string, maxLength: number): string {
	if (text.length <= maxLength || maxLength <= 3) {
		return text;
	}
	return `${text.slice(0, maxLength - 3)}...`;
}

export function StatusBar({
	provider = "-",
	model = "-",
	agent = "-",
	tool = "-",
}: StatusBarProps): ReactElement {
	const { stdout } = useStdout();
	const columns = stdout.columns ?? 80;
	const leftText = "Infinity TUI";
	const rightText = "Ctrl+C to quit";
	const reserved = leftText.length + rightText.length + 4;
	const centerMaxWidth = Math.max(10, columns - reserved);
	const centerText = `Provider: ${provider} | Model: ${model} | Agent: ${agent} | Tool: ${tool}`;
	const displayCenter = truncateCenter(centerText, centerMaxWidth);

	return (
		<Box height={1} flexDirection="row" backgroundColor="cyan" paddingX={1}>
			<Text color="black" bold>
				{leftText}
			</Text>
			<Spacer />
			<Text color="black">{displayCenter}</Text>
			<Spacer />
			<Text color="black">{rightText}</Text>
		</Box>
	);
}
